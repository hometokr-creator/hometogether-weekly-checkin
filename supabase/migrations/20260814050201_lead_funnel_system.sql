-- Production migration version: 20260814050201.
begin;

-- Kakao channel 1:1 messages are not received through this schema. A lead is
-- deliberately created before the visitor leaves the web product for Kakao.
-- This keeps attribution and the operational funnel in HomeTogether without
-- claiming a non-existent Kakao message webhook integration.

alter table public.admin_memberships
  drop constraint if exists admin_memberships_permissions_check;

alter table public.admin_memberships
  add constraint admin_memberships_permissions_check check (
    cardinality(permissions) > 0
    and permissions <@ array[
      'CHECKIN_READ', 'SAFETY_READ', 'CONTACT_READ', 'DATA_EXPORT', 'CASE_WRITE', 'SUPER_ADMIN',
      'LEAD_READ', 'LEAD_WRITE', 'LEAD_IMPORT', 'LEAD_ANALYTICS'
    ]::text[]
  );

-- All listing facts are nullable on purpose. A null is rendered as "확인 필요"
-- in operational interfaces instead of being silently represented as false.
alter table public.homes
  add column if not exists transfer_registration_available boolean,
  add column if not exists minimum_term_months integer,
  add column if not exists monthly_price_1 integer,
  add column if not exists monthly_price_3 integer,
  add column if not exists monthly_price_4 integer,
  add column if not exists monthly_price_6 integer,
  add column if not exists deposit_amount integer,
  add column if not exists management_fee_amount integer,
  add column if not exists kitchen_available boolean,
  add column if not exists curfew text,
  add column if not exists air_conditioner_available boolean,
  add column if not exists bathroom_type text,
  add column if not exists other_family_members_live boolean,
  add column if not exists host_gender text,
  add column if not exists host_introduction text,
  add column if not exists pets text,
  add column if not exists photo_urls text[] not null default '{}'::text[],
  add column if not exists viewing_hours text,
  add column if not exists immediate_viewing_available boolean,
  add column if not exists facility_checked_at date;

alter table public.homes
  add constraint homes_minimum_term_months_check check (
    minimum_term_months is null or minimum_term_months between 1 and 120
  ),
  add constraint homes_listing_amounts_check check (
    coalesce(monthly_price_1, 0) >= 0
    and coalesce(monthly_price_3, 0) >= 0
    and coalesce(monthly_price_4, 0) >= 0
    and coalesce(monthly_price_6, 0) >= 0
    and coalesce(deposit_amount, 0) >= 0
    and coalesce(management_fee_amount, 0) >= 0
  ),
  add constraint homes_curfew_length_check check (
    curfew is null or char_length(curfew) between 1 and 120
  ),
  add constraint homes_bathroom_type_length_check check (
    bathroom_type is null or char_length(bathroom_type) between 1 and 120
  ),
  add constraint homes_host_gender_check check (
    host_gender is null or host_gender in ('FEMALE', 'MALE', 'MIXED', 'OTHER', 'UNSPECIFIED')
  ),
  add constraint homes_host_introduction_length_check check (
    host_introduction is null or char_length(host_introduction) <= 2_000
  ),
  add constraint homes_pets_length_check check (
    pets is null or char_length(pets) <= 500
  ),
  add constraint homes_photo_urls_check check (
    cardinality(photo_urls) <= 20
    and array_position(photo_urls, '') is null
    and array_position(photo_urls, null) is null
    and char_length(array_to_string(photo_urls, '')) <= 40_960
  ),
  add constraint homes_viewing_hours_length_check check (
    viewing_hours is null or char_length(viewing_hours) <= 500
  );

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_profile_id uuid references public.profiles(id) on delete set null,
  -- The label is an operator-facing identifier. Phone numbers and Kakao chat
  -- contents must not be written here or into audit/outbox payloads.
  customer_label text,
  customer_type text not null default 'UNKNOWN' check (
    customer_type in ('GUEST', 'HOST', 'GUEST_PARENT', 'HOST_CHILD', 'UNKNOWN')
  ),
  customer_tags text[] not null default '{}'::text[] check (
    customer_tags <@ array[
      'UNIVERSITY_STUDENT', 'GRADUATE_STUDENT', 'TRANSFER_STUDENT',
      'GRADUATE', 'RETAKER', 'HIGH_SCHOOL_STUDENT', 'INTERN',
      'EARLY_CAREER', 'FOREIGNER', 'OTHER'
    ]::text[]
  ),
  source text not null default 'WEBSITE' check (
    source in ('KAKAO', 'EVERYTIME', 'INSTAGRAM', 'WEBSITE', 'REFERRAL', 'ETC')
  ),
  source_detail text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  landing_path text,
  desired_region text,
  desired_move_in date,
  desired_term_months integer,
  budget_monthly integer,
  budget_deposit integer,
  must_have jsonb not null default '[]'::jsonb check (jsonb_typeof(must_have) = 'array'),
  status text not null default 'NEW' check (
    status in (
      'NEW', 'CONTACTED', 'VIEWING_REQUESTED', 'VIEWING_CONFIRMED',
      'VIEWED', 'REGISTERED', 'CHURNED'
    )
  ),
  original_listing_id uuid references public.homes(id) on delete set null,
  original_listing_available boolean,
  alternative_listing_used boolean not null default false,
  created_at timestamptz not null default now(),
  first_response_at timestamptz,
  last_contact_at timestamptz,
  assigned_admin_id uuid references public.admin_memberships(user_id) on delete set null,
  sla_breached_at timestamptz,
  sla_escalated_at timestamptz,
  import_source text,
  import_record_id text,
  import_confidence text check (import_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  updated_at timestamptz not null default now(),
  check (desired_term_months is null or desired_term_months between 1 and 120),
  check (budget_monthly is null or budget_monthly >= 0),
  check (budget_deposit is null or budget_deposit >= 0),
  check ((import_source is null) = (import_record_id is null)),
  check (customer_label is null or char_length(customer_label) between 1 and 120),
  check (source_detail is null or char_length(source_detail) <= 500),
  check (desired_region is null or char_length(desired_region) <= 200),
  check (landing_path is null or char_length(landing_path) <= 1_000)
);

create unique index leads_import_source_record_unique_idx
  on public.leads(import_source, import_record_id)
  where import_source is not null and import_record_id is not null;
create index leads_created_status_idx on public.leads(created_at desc, status);
create index leads_assigned_status_idx on public.leads(assigned_admin_id, status, created_at desc);
create index leads_source_created_idx on public.leads(source, created_at desc);
create index leads_region_created_idx on public.leads(desired_region, created_at desc)
  where desired_region is not null;

create table public.lead_listing_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  listing_id uuid not null references public.homes(id) on delete restrict,
  event_type text not null check (
    event_type in ('IMPRESSION', 'CLICK', 'INQUIRY', 'VIEWING_REQUEST', 'ALTERNATIVE_RECOMMENDATION')
  ),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);
create index lead_listing_events_lead_occurred_idx
  on public.lead_listing_events(lead_id, occurred_at);
create index lead_listing_events_listing_type_idx
  on public.lead_listing_events(listing_id, event_type, occurred_at);

create table public.viewing_slots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.homes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_available boolean not null default true,
  created_by_admin_id uuid references public.admin_memberships(user_id) on delete set null,
  created_by_host_profile_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (created_by_admin_id is not null or created_by_host_profile_id is not null),
  check (notes is null or char_length(notes) <= 500)
);
create index viewing_slots_available_listing_idx
  on public.viewing_slots(listing_id, starts_at)
  where is_available;

create table public.viewing_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  listing_id uuid not null references public.homes(id) on delete restrict,
  slot_id uuid references public.viewing_slots(id) on delete set null,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  viewing_at timestamptz,
  cancelled_at timestamptz,
  cancellation_actor text check (
    cancellation_actor in ('CUSTOMER', 'HOST', 'ADMIN', 'SYSTEM')
  ),
  cancellation_reason text,
  created_by_admin_id uuid references public.admin_memberships(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  check (confirmed_at is null or confirmed_at >= requested_at),
  check (viewing_at is null or viewing_at >= requested_at),
  check (cancelled_at is null or cancelled_at >= requested_at),
  check ((cancelled_at is null) = (cancellation_actor is null)),
  check (cancellation_reason is null or char_length(cancellation_reason) <= 1_000)
);
create index viewing_events_lead_requested_idx on public.viewing_events(lead_id, requested_at desc);
create index viewing_events_listing_requested_idx on public.viewing_events(listing_id, requested_at desc);
create unique index viewing_events_active_slot_unique_idx
  on public.viewing_events(slot_id) where slot_id is not null and cancelled_at is null;

create table public.lead_outcomes (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  outcome text not null default 'ONGOING' check (outcome in ('REGISTERED', 'CHURNED', 'ONGOING')),
  churn_stage text check (
    churn_stage in ('INQUIRY', 'VIEWING_SCHEDULED', 'AFTER_VIEWING', 'AFTER_REGISTRATION')
  ),
  churn_reason text check (
    churn_reason in (
      'RESPONSE_DELAY', 'LISTING_CONDITION', 'LOCATION', 'NO_INVENTORY',
      'CONTRACT_TERM', 'PRICE', 'DEPOSIT', 'MOVE_IN_REGISTRATION', 'KITCHEN',
      'CURFEW', 'HOST_INFO', 'FAMILY_OPPOSITION', 'OTHER_PROPERTY',
      'PERSONAL_REASON', 'UNKNOWN'
    )
  ),
  churn_reason_note text,
  closed_at timestamptz,
  updated_by_admin_id uuid references public.admin_memberships(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (outcome = 'CHURNED' and churn_stage is not null and churn_reason is not null and closed_at is not null)
    or (outcome = 'REGISTERED' and closed_at is not null)
    or (outcome = 'ONGOING' and churn_stage is null and churn_reason is null and closed_at is null)
  ),
  check (churn_reason_note is null or char_length(churn_reason_note) <= 2_000)
);
create index lead_outcomes_outcome_closed_idx on public.lead_outcomes(outcome, closed_at desc);
create index lead_outcomes_churn_reason_idx on public.lead_outcomes(churn_reason)
  where churn_reason is not null;

create table public.lead_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.admin_memberships(user_id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  source_system text not null check (char_length(source_system) between 1 and 80),
  status text not null default 'APPLYING' check (status in ('APPLYING', 'APPLIED', 'FAILED')),
  total_rows integer not null default 0 check (total_rows between 0 and 2_000),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  skipped_rows integer not null default 0 check (skipped_rows >= 0),
  error_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(error_summary) = 'array'),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'APPLIED') = (applied_at is not null))
);
create unique index lead_import_batches_applied_file_unique_idx
  on public.lead_import_batches(file_sha256)
  where status = 'APPLIED';

create table public.lead_sla_alerts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  alert_stage text not null check (alert_stage in ('WARNING_7M', 'BREACH_10M', 'ESCALATION_15M')),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SKIPPED', 'DELIVERED', 'FAILED')),
  outbox_dedupe_key text not null unique check (char_length(outbox_dedupe_key) between 8 and 200),
  created_at timestamptz not null default now(),
  unique (lead_id, alert_stage)
);
create index lead_sla_alerts_stage_created_idx on public.lead_sla_alerts(alert_stage, created_at desc);

create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
create trigger viewing_slots_set_updated_at before update on public.viewing_slots
  for each row execute function public.set_updated_at();
create trigger viewing_events_set_updated_at before update on public.viewing_events
  for each row execute function public.set_updated_at();
create trigger lead_outcomes_set_updated_at before update on public.lead_outcomes
  for each row execute function public.set_updated_at();
create trigger lead_import_batches_set_updated_at before update on public.lead_import_batches
  for each row execute function public.set_updated_at();

-- Keep the generic, signed operations outbox as the only external delivery
-- mechanism. This extends its constrained vocabulary rather than adding a
-- second webhook dispatcher or embedding a vendor/API key in the app.
alter table public.integration_outbox
  drop constraint if exists integration_outbox_event_type_check,
  drop constraint if exists integration_outbox_aggregate_type_check;
alter table public.integration_outbox
  add constraint integration_outbox_event_type_check check (
    event_type in (
      'weekly_checkin.completed', 'weekly_checkin.risk_detected',
      'support_case.created', 'support_case.updated', 'admin_alert.critical_case',
      'lead.sla_warning', 'lead.sla_breach', 'lead.sla_escalation'
    )
  ),
  add constraint integration_outbox_aggregate_type_check check (
    aggregate_type in ('RESPONSE', 'SUPPORT_CASE', 'LEAD')
  );

alter table public.cron_execution_logs
  drop constraint if exists cron_execution_logs_job_name_check;
alter table public.cron_execution_logs
  add constraint cron_execution_logs_job_name_check check (
    job_name in ('WEEKLY_CHECKINS', 'CHECKIN_REMINDERS', 'CHECKIN_OUTBOX', 'LEAD_SLA')
  );

create or replace function public.record_cron_execution(
  p_request_id uuid,
  p_job_name text,
  p_status text,
  p_target_count integer default 0,
  p_sent_count integer default 0,
  p_failed_count integer default 0,
  p_error_code text default null
)
returns public.cron_execution_logs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_log public.cron_execution_logs%rowtype;
begin
  if p_request_id is null
     or p_job_name not in ('WEEKLY_CHECKINS', 'CHECKIN_REMINDERS', 'CHECKIN_OUTBOX', 'LEAD_SLA')
     or p_status not in ('STARTED', 'COMPLETED', 'FAILED')
     or p_target_count < 0
     or p_sent_count < 0
     or p_failed_count < 0
     or (p_error_code is not null and char_length(p_error_code) > 120) then
    raise exception 'invalid_cron_execution_log' using errcode = '22023';
  end if;

  insert into public.cron_execution_logs (
    request_id, job_name, status, target_count, sent_count, failed_count,
    error_code, started_at, finished_at
  ) values (
    p_request_id, p_job_name, p_status, p_target_count, p_sent_count,
    p_failed_count,
    case when p_status = 'FAILED' then nullif(left(p_error_code, 120), '') else null end,
    clock_timestamp(), case when p_status = 'STARTED' then null else clock_timestamp() end
  )
  on conflict (request_id) do update set
    job_name = excluded.job_name,
    status = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.status else excluded.status end,
    target_count = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.target_count else excluded.target_count end,
    sent_count = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.sent_count else excluded.sent_count end,
    failed_count = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.failed_count else excluded.failed_count end,
    error_code = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.error_code else excluded.error_code end,
    finished_at = case when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
      then public.cron_execution_logs.finished_at else excluded.finished_at end
  returning * into v_log;
  return v_log;
end;
$$;

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
  -- A first response stops all pending SLA states. Imported historical leads
  -- are intentionally excluded: backfill time is not an operational SLA.
  -- The caller is a trusted server cron route; public clients have no EXECUTE
  -- grant. If the cron resumes after downtime, every missed threshold is
  -- queued once, in order, by the unique (lead_id, alert_stage) constraint.
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
    insert into public.lead_sla_alerts (lead_id, alert_stage, outbox_dedupe_key)
    select
      overdue.id,
      overdue.stage,
      'lead-sla:' || overdue.id::text || ':' || lower(overdue.stage)
    from overdue
    join marked on marked.id = overdue.id
    on conflict (lead_id, alert_stage) do nothing
    returning lead_id, alert_stage, outbox_dedupe_key
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

-- This reporting view deliberately exposes no contact information. It offers
-- stable time calculations for admin analytics and CSV exports while all raw
-- lead tables remain RLS-protected and server-only.
create or replace view public.lead_funnel_metrics
with (security_invoker = true)
as
select
  lead.id as lead_id,
  lead.created_at,
  lead.first_response_at,
  lead.status,
  lead.source,
  lead.desired_region,
  lead.desired_term_months,
  lead.original_listing_available,
  lead.alternative_listing_used,
  outcome.outcome,
  outcome.churn_stage,
  outcome.churn_reason,
  min(viewing.requested_at) as first_viewing_requested_at,
  min(viewing.confirmed_at) filter (where viewing.confirmed_at is not null) as first_viewing_confirmed_at,
  min(viewing.viewing_at) filter (where viewing.viewing_at is not null) as first_viewing_at,
  extract(epoch from (lead.first_response_at - lead.created_at)) / 60.0 as first_response_minutes,
  extract(epoch from (min(viewing.requested_at) - lead.created_at)) / 60.0 as inquiry_to_viewing_request_minutes,
  extract(epoch from (
    min(viewing.confirmed_at) filter (where viewing.confirmed_at is not null)
    - min(viewing.requested_at)
  )) / 60.0 as viewing_request_to_confirmation_minutes,
  extract(epoch from (
    min(viewing.viewing_at) filter (where viewing.viewing_at is not null)
    - min(viewing.confirmed_at) filter (where viewing.confirmed_at is not null)
  )) / 60.0 as confirmation_to_viewing_minutes,
  extract(epoch from (outcome.closed_at - lead.created_at)) / 3600.0 as total_lead_to_registration_hours
from public.leads lead
left join public.viewing_events viewing on viewing.lead_id = lead.id
left join public.lead_outcomes outcome on outcome.lead_id = lead.id
group by lead.id, outcome.lead_id;

alter table public.leads enable row level security;
alter table public.lead_listing_events enable row level security;
alter table public.viewing_slots enable row level security;
alter table public.viewing_events enable row level security;
alter table public.lead_outcomes enable row level security;
alter table public.lead_import_batches enable row level security;
alter table public.lead_sla_alerts enable row level security;

revoke all on table
  public.leads,
  public.lead_listing_events,
  public.viewing_slots,
  public.viewing_events,
  public.lead_outcomes,
  public.lead_import_batches,
  public.lead_sla_alerts,
  public.lead_funnel_metrics
from public, anon, authenticated;
grant all on table
  public.leads,
  public.lead_listing_events,
  public.viewing_slots,
  public.viewing_events,
  public.lead_outcomes,
  public.lead_import_batches,
  public.lead_sla_alerts
to service_role;

revoke all on function public.queue_lead_sla_alerts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.queue_lead_sla_alerts(timestamptz) to service_role;

-- Keep the administrator-management RPC aligned with the expanded role set.
create or replace function public.admin_set_membership(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_permissions text[],
  p_is_active boolean,
  p_reason text default null
)
returns public.admin_memberships
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_verified boolean;
  v_before public.admin_memberships%rowtype;
  v_after public.admin_memberships%rowtype;
  v_before_json jsonb;
  v_after_json jsonb;
begin
  if not public.admin_has_permission(p_actor_id, 'SUPER_ADMIN') then
    raise exception 'admin_management_forbidden' using errcode = '42501';
  end if;
  if p_target_user_id is null
     or p_permissions is null
     or cardinality(p_permissions) = 0
     or not (
       p_permissions <@ array[
         'CHECKIN_READ', 'SAFETY_READ', 'CONTACT_READ', 'DATA_EXPORT', 'CASE_WRITE', 'SUPER_ADMIN',
         'LEAD_READ', 'LEAD_WRITE', 'LEAD_IMPORT', 'LEAD_ANALYTICS'
       ]::text[]
     )
     or (p_reason is not null and char_length(trim(p_reason)) not between 1 and 500) then
    raise exception 'invalid_admin_membership' using errcode = '22023';
  end if;

  select exists (
    select 1 from auth.users where id = p_target_user_id and email_confirmed_at is not null
  ) into v_verified;
  if not v_verified then
    raise exception 'admin_target_not_verified' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hometogether-admin-memberships', 0));
  select * into v_before from public.admin_memberships
  where user_id = p_target_user_id for update;

  if found
     and v_before.is_active
     and 'SUPER_ADMIN' = any(v_before.permissions)
     and (not p_is_active or not ('SUPER_ADMIN' = any(p_permissions)))
     and not exists (
       select 1 from public.admin_memberships other_admin
       where other_admin.user_id <> p_target_user_id
         and other_admin.is_active
         and 'SUPER_ADMIN' = any(other_admin.permissions)
     ) then
    raise exception 'last_super_admin_protected' using errcode = '23514';
  end if;

  v_before_json := case when v_before.user_id is null then null else jsonb_build_object(
    'permissions', v_before.permissions, 'isActive', v_before.is_active,
    'grantSource', v_before.grant_source
  ) end;

  insert into public.admin_memberships (
    user_id, permissions, is_active, grant_source, granted_by,
    deactivated_by, deactivated_at, deactivation_reason
  ) values (
    p_target_user_id, p_permissions, p_is_active, 'ADMIN_UI', p_actor_id,
    case when p_is_active then null else p_actor_id end,
    case when p_is_active then null else clock_timestamp() end,
    case when p_is_active then null else nullif(trim(p_reason), '') end
  )
  on conflict (user_id) do update set
    permissions = excluded.permissions,
    is_active = excluded.is_active,
    deactivated_by = excluded.deactivated_by,
    deactivated_at = excluded.deactivated_at,
    deactivation_reason = excluded.deactivation_reason
  returning * into v_after;

  v_after_json := jsonb_build_object(
    'permissions', v_after.permissions, 'isActive', v_after.is_active,
    'grantSource', v_after.grant_source
  );
  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_actor_id, 'ADMIN_MEMBERSHIP', p_target_user_id,
    case
      when v_before.user_id is null then 'ADD_ADMIN'
      when p_is_active and not v_before.is_active then 'REACTIVATE_ADMIN'
      when not p_is_active then 'DEACTIVATE_ADMIN'
      else 'UPDATE_ADMIN_PERMISSIONS'
    end,
    v_before_json, v_after_json
  );
  return v_after;
end;
$$;

revoke all on function public.admin_set_membership(uuid, uuid, text[], boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_membership(uuid, uuid, text[], boolean, text)
  to service_role;

commit;
