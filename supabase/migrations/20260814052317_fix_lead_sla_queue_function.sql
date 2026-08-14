-- Production migration version: 20260814052317.
begin;

-- The original lead-funnel migration created this function successfully, but
-- its output-column names shadowed the conflict target during execution. Keep
-- the public function signature and all idempotency semantics unchanged while
-- qualifying the inserted rows.
create or replace function public.queue_lead_sla_alerts(
  p_now timestamptz default clock_timestamp()
)
returns table (
  lead_id uuid,
  alert_stage text,
  outbox_dedupe_key text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with overdue as (
    select
      lead.id,
      due.stage
    from public.leads lead
    cross join lateral unnest(
      case
        when lead.created_at <= p_now - interval '15 minutes'
          then array['WARNING_7M', 'BREACH_10M', 'ESCALATION_15M']::text[]
        when lead.created_at <= p_now - interval '10 minutes'
          then array['WARNING_7M', 'BREACH_10M']::text[]
        else array['WARNING_7M']::text[]
      end
    ) as due(stage)
    where lead.status not in ('REGISTERED', 'CHURNED')
      and lead.first_response_at is null
      and lead.import_source is null
      and lead.created_at <= p_now - interval '7 minutes'
  ), marked as (
    update public.leads lead
    set sla_breached_at = case
          when exists (
            select 1 from overdue due
            where due.id = lead.id and due.stage in ('BREACH_10M', 'ESCALATION_15M')
          ) then coalesce(lead.sla_breached_at, p_now)
          else lead.sla_breached_at
        end,
        sla_escalated_at = case
          when exists (
            select 1 from overdue due
            where due.id = lead.id and due.stage = 'ESCALATION_15M'
          ) then coalesce(lead.sla_escalated_at, p_now)
          else lead.sla_escalated_at
        end
    where lead.id in (select overdue.id from overdue)
    returning lead.id
  ), inserted_alerts as (
    insert into public.lead_sla_alerts as new_alert (
      lead_id, alert_stage, outbox_dedupe_key
    )
    select
      overdue.id,
      overdue.stage,
      'lead-sla:' || overdue.id::text || ':' || lower(overdue.stage)
    from overdue
    join marked on marked.id = overdue.id
    on conflict do nothing
    returning
      new_alert.lead_id,
      new_alert.alert_stage,
      new_alert.outbox_dedupe_key
  ), inserted_outbox as (
    insert into public.integration_outbox (
      event_type, aggregate_type, aggregate_id, payload, dedupe_key, destination
    )
    select
      case alert.alert_stage
        when 'WARNING_7M' then 'lead.sla_warning'
        when 'BREACH_10M' then 'lead.sla_breach'
        else 'lead.sla_escalation'
      end,
      'LEAD',
      alert.lead_id,
      jsonb_build_object(
        'leadId', alert.lead_id,
        'stage', alert.alert_stage,
        'source', lead.source,
        'desiredRegion', lead.desired_region,
        'createdAt', lead.created_at,
        'isTest', false
      ),
      alert.outbox_dedupe_key,
      'ADMIN_ALERT'
    from inserted_alerts alert
    join public.leads lead on lead.id = alert.lead_id
    on conflict (dedupe_key) do nothing
    returning aggregate_id, dedupe_key
  )
  select alert.lead_id, alert.alert_stage, alert.outbox_dedupe_key
  from inserted_alerts alert;
end;
$$;

revoke all on function public.queue_lead_sla_alerts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_lead_sla_alerts(timestamptz) to service_role;

commit;
