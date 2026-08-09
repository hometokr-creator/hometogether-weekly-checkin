begin;

-- Separate ordinary dashboard access from raw contact data and bulk export.
-- The application server uses a service-role DAL after authenticating every
-- request; direct Data API access is intentionally narrower.
do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.admin_memberships'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%permissions <@%'
  loop
    execute format(
      'alter table public.admin_memberships drop constraint %I',
      v_constraint.conname
    );
  end loop;
end
$migration$;

alter table public.admin_memberships
  add constraint admin_memberships_allowed_permissions_check check (
    permissions <@ array[
      'CHECKIN_READ',
      'SAFETY_READ',
      'CONTACT_READ',
      'DATA_EXPORT',
      'CASE_WRITE',
      'SUPER_ADMIN'
    ]::text[]
  );

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_contact_admin on public.profiles
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or (
      public.is_admin('CONTACT_READ')
      and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
    )
  );

drop policy if exists homes_select_admin on public.homes;
create policy homes_select_contact_admin on public.homes
  for select to authenticated using (
    public.is_admin('CONTACT_READ')
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );

drop policy if exists matches_select_admin on public.matches;
create policy matches_select_contact_admin on public.matches
  for select to authenticated using (
    public.is_admin('CONTACT_READ')
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );

drop policy if exists weekly_responses_select_authorized_admin
  on public.weekly_checkin_responses;
create policy weekly_responses_select_export_admin
  on public.weekly_checkin_responses
  for select to authenticated using (
    public.is_admin('DATA_EXPORT')
    and public.is_admin('SAFETY_READ')
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );

drop policy if exists weekly_issues_select_authorized_admin
  on public.weekly_checkin_issues;
create policy weekly_issues_select_export_admin on public.weekly_checkin_issues
  for select to authenticated using (
    public.is_admin('DATA_EXPORT')
    and public.is_admin('SAFETY_READ')
    and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
  );

-- Production message rows contain only a masked recipient. ADMIN_TEST rows
-- retain the one approved test phone and therefore require SUPER_ADMIN+AAL2
-- even when accessed directly through the Data API.
drop policy if exists message_logs_select_authorized_admin
  on public.message_logs;
create policy message_logs_select_authorized_admin on public.message_logs
  for select to authenticated
  using (
    (delivery_scope = 'PRODUCTION' and public.is_admin('CHECKIN_READ'))
    or (
      delivery_scope = 'ADMIN_TEST'
      and public.is_admin('SUPER_ADMIN')
      and coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
    )
  );

-- Keep the existing membership lifecycle and last-SUPER_ADMIN protection,
-- expanding only the accepted least-privilege permission names.
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
         'CHECKIN_READ', 'SAFETY_READ', 'CONTACT_READ', 'DATA_EXPORT',
         'CASE_WRITE', 'SUPER_ADMIN'
       ]::text[]
     )
     or (p_reason is not null and char_length(trim(p_reason)) not between 1 and 500) then
    raise exception 'invalid_admin_membership' using errcode = '22023';
  end if;

  select exists (
    select 1 from auth.users
    where id = p_target_user_id and email_confirmed_at is not null
  ) into v_verified;
  if not v_verified then
    raise exception 'admin_target_not_verified' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hometogether-admin-memberships', 0)
  );

  select * into v_before
  from public.admin_memberships
  where user_id = p_target_user_id
  for update;

  if found
     and v_before.is_active
     and 'SUPER_ADMIN' = any(v_before.permissions)
     and (not p_is_active or not ('SUPER_ADMIN' = any(p_permissions)))
     and not exists (
       select 1
       from public.admin_memberships other_admin
       where other_admin.user_id <> p_target_user_id
         and other_admin.is_active
         and 'SUPER_ADMIN' = any(other_admin.permissions)
     ) then
    raise exception 'last_super_admin_protected' using errcode = '23514';
  end if;

  v_before_json := case when v_before.user_id is null then null else jsonb_build_object(
    'permissions', v_before.permissions,
    'isActive', v_before.is_active,
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
  on conflict (user_id) do update
  set permissions = excluded.permissions,
      is_active = excluded.is_active,
      deactivated_by = excluded.deactivated_by,
      deactivated_at = excluded.deactivated_at,
      deactivation_reason = excluded.deactivation_reason
  returning * into v_after;

  v_after_json := jsonb_build_object(
    'permissions', v_after.permissions,
    'isActive', v_after.is_active,
    'grantSource', v_after.grant_source
  );

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_actor_id,
    'ADMIN_MEMBERSHIP',
    p_target_user_id,
    case
      when v_before.user_id is null then 'ADD_ADMIN'
      when p_is_active and not v_before.is_active then 'REACTIVATE_ADMIN'
      when not p_is_active then 'DEACTIVATE_ADMIN'
      else 'UPDATE_ADMIN_PERMISSIONS'
    end,
    v_before_json,
    v_after_json
  );

  return v_after;
end;
$$;

revoke all on function public.admin_set_membership(
  uuid, uuid, text[], boolean, text
) from public, anon, authenticated;
grant execute on function public.admin_set_membership(
  uuid, uuid, text[], boolean, text
) to service_role;

-- Provider acceptance and final handset delivery are different states. Keep
-- the existing outbox status for dispatch leasing and add a monotonic delivery
-- state plus append-only, payload-free receipts.
alter table public.message_logs
  add column if not exists delivery_status text not null default 'UNKNOWN',
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_delivery_receipt_at timestamptz;

update public.message_logs
set delivery_status = case
      when status = 'SENT' then 'ACCEPTED'
      when status = 'FAILED' then 'FAILED'
      else 'UNKNOWN'
    end,
    accepted_at = case when status = 'SENT' then coalesce(sent_at, updated_at) end
where delivery_status = 'UNKNOWN';

alter table public.message_logs
  add constraint message_logs_delivery_status_check check (
    delivery_status in ('ACCEPTED', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN')
  ),
  add constraint message_logs_delivery_timestamps_check check (
    delivered_at is null or accepted_at is not null
  ),
  add constraint message_logs_delivery_queue_consistency_check check (
    delivery_status = 'UNKNOWN'
    or (
      delivery_status in ('ACCEPTED', 'SENT', 'DELIVERED')
      and status = 'SENT'
    )
    or (delivery_status = 'FAILED' and status = 'FAILED')
  );

create unique index if not exists message_logs_provider_message_unique_idx
  on public.message_logs(provider, provider_message_id)
  where provider_message_id is not null;

create table public.message_delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  message_log_id uuid references public.message_logs(id) on delete set null,
  provider text not null check (char_length(provider) between 1 and 40),
  provider_event_id text not null check (char_length(provider_event_id) between 8 and 160),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  delivery_status text not null check (
    delivery_status in ('ACCEPTED', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN')
  ),
  occurred_at timestamptz,
  signature_timestamp timestamptz not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or char_length(error_code) between 1 and 80),
  received_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_event_id)
);

comment on table public.message_delivery_receipts is
  'Signed, idempotent delivery metadata only. Raw provider callback bodies and recipient PII are never stored.';

create index message_delivery_receipts_unmatched_idx
  on public.message_delivery_receipts(provider, provider_message_id, received_at)
  where message_log_id is null;

create index message_delivery_receipts_message_log_id_idx
  on public.message_delivery_receipts(message_log_id);

alter table public.message_delivery_receipts enable row level security;
revoke all on table public.message_delivery_receipts from public, anon, authenticated;
grant select on table public.message_delivery_receipts to service_role;

create or replace function public.message_delivery_next_status(
  p_current text,
  p_incoming text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_current in ('DELIVERED', 'FAILED') then p_current
    when p_current = 'SENT' and p_incoming in ('DELIVERED', 'FAILED') then p_incoming
    when p_current = 'ACCEPTED' and p_incoming in ('SENT', 'DELIVERED', 'FAILED') then p_incoming
    when p_current = 'UNKNOWN' and p_incoming <> 'UNKNOWN' then p_incoming
    else p_current
  end;
$$;

create or replace function public.sync_message_delivery_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'SENT' and new.provider_message_id is not null then
    new.delivery_status := public.message_delivery_next_status(
      coalesce(new.delivery_status, 'UNKNOWN'),
      'ACCEPTED'
    );
    new.accepted_at := coalesce(new.accepted_at, new.sent_at, clock_timestamp());
  elsif new.status = 'FAILED' and coalesce(new.delivery_status, 'UNKNOWN') = 'UNKNOWN' then
    new.delivery_status := 'FAILED';
  end if;
  return new;
end;
$$;

create trigger message_logs_sync_delivery_acceptance
before insert or update of status, provider_message_id on public.message_logs
for each row execute function public.sync_message_delivery_acceptance();

-- The provider can acknowledge a send quickly enough for its callback to race
-- the transaction that stores provider_message_id. Both paths take the same
-- transaction advisory lock before either locks/reads the message row, so one
-- side always observes the committed result of the other.
create or replace function public.complete_message_delivery(
  p_message_log_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message_sanitized text default null,
  p_retryable boolean default false,
  p_next_attempt_at timestamptz default null,
  p_failure_class text default null
)
returns public.message_logs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_log public.message_logs%rowtype;
  v_provider text;
  v_result_status text;
  v_can_retry boolean;
  v_failure_class text;
begin
  select message.provider into v_provider
  from public.message_logs message
  where message.id = p_message_log_id;

  if not found then
    raise exception 'message_log_not_found' using errcode = 'P0002';
  end if;

  if p_provider_message_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'hometogether-message-delivery:' || v_provider || ':' || p_provider_message_id,
      0
    ));
  end if;

  select * into v_log
  from public.message_logs
  where id = p_message_log_id
  for update;

  if v_log.status = 'SENT' and p_success then
    return v_log;
  end if;
  if v_log.status <> 'SENDING' or v_log.lease_owner is distinct from p_lease_owner then
    raise exception 'message_delivery_lease_mismatch' using errcode = '55000';
  end if;
  if p_failure_class is not null
     and p_failure_class not in ('TRANSIENT', 'PERMANENT', 'UNKNOWN') then
    raise exception 'invalid_message_failure_class' using errcode = '22023';
  end if;

  v_failure_class := case
    when p_success then null
    when p_failure_class is not null then p_failure_class
    when p_retryable then 'TRANSIENT'
    else 'PERMANENT'
  end;
  v_can_retry := not p_success
    and p_retryable
    and v_log.attempt_count < v_log.max_attempts;
  v_result_status := case
    when p_success then 'SENT'
    when v_can_retry then 'RETRYABLE'
    else 'FAILED'
  end;

  insert into public.message_attempts (
    message_log_id, attempt_number, status, provider_message_id,
    error_code, error_message_sanitized, failure_class
  ) values (
    v_log.id, v_log.attempt_count, v_result_status, p_provider_message_id,
    left(p_error_code, 80), left(p_error_message_sanitized, 500), v_failure_class
  ) on conflict (message_log_id, attempt_number) do nothing;

  update public.message_logs
  set status = v_result_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_code = case when p_success then null else left(p_error_code, 80) end,
      error_message_sanitized = case
        when p_success then null else left(p_error_message_sanitized, 500)
      end,
      failure_class = v_failure_class,
      sent_at = case when p_success then clock_timestamp() else sent_at end,
      next_attempt_at = case when v_can_retry then p_next_attempt_at else null end,
      lease_owner = null,
      lease_until = null
  where id = v_log.id
  returning * into v_log;

  -- The provider callback can have been waiting on the same advisory lock.
  -- Re-read the row after the AFTER trigger attaches that receipt, then let
  -- the committed delivery state (not the stale transport result) drive the
  -- invitation and attempt state.
  select * into v_log
  from public.message_logs
  where id = p_message_log_id
  for update;

  if v_log.status = 'SENT' then
    update public.message_attempts
    set status = 'SENT',
        provider_message_id = coalesce(v_log.provider_message_id, provider_message_id),
        error_code = null,
        error_message_sanitized = null,
        failure_class = null
    where message_log_id = v_log.id
      and attempt_number = v_log.attempt_count;
  elsif v_log.status = 'FAILED' then
    update public.message_attempts
    set status = 'FAILED',
        provider_message_id = coalesce(v_log.provider_message_id, provider_message_id),
        failure_class = coalesce(v_log.failure_class, failure_class, 'PERMANENT')
    where message_log_id = v_log.id
      and attempt_number = v_log.attempt_count;
  end if;

  if v_log.message_type = 'WEEKLY_CHECKIN' then
    update public.weekly_checkin_invitations
    set status = case
          when v_log.status = 'SENT' then 'SENT'
          when v_log.status = 'RETRYABLE' then 'PENDING'
          else 'FAILED'
        end,
        sent_at = case when v_log.status = 'SENT' then coalesce(sent_at, v_log.sent_at) else sent_at end,
        next_attempt_at = case when v_log.status = 'RETRYABLE' then v_log.next_attempt_at else null end,
        last_error_code = case when v_log.status = 'SENT' then null else v_log.error_code end,
        lease_owner = null,
        lease_until = null
    where id = v_log.invitation_id
      and completed_at is null
      and status in ('PENDING', 'SENDING', 'SENT', 'FAILED');
  elsif v_log.message_type = 'WEEKLY_CHECKIN_REMINDER' and v_log.status = 'SENT' then
    update public.weekly_checkin_invitations
    set reminder_sent_at = coalesce(reminder_sent_at, v_log.sent_at, clock_timestamp())
    where id = v_log.invitation_id
      and completed_at is null;
  end if;

  return v_log;
end;
$$;

create or replace function public.attach_pending_message_delivery_receipts()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_receipt public.message_delivery_receipts%rowtype;
  v_status text := coalesce(new.delivery_status, 'UNKNOWN');
  v_latest timestamptz;
  v_error_code text;
begin
  if new.provider_message_id is null then
    return null;
  end if;

  for v_receipt in
    select *
    from public.message_delivery_receipts receipt
    where receipt.provider = new.provider
      and receipt.provider_message_id = new.provider_message_id
    order by coalesce(receipt.occurred_at, receipt.received_at), receipt.id
  loop
    v_status := public.message_delivery_next_status(v_status, v_receipt.delivery_status);
    v_latest := greatest(v_latest, v_receipt.received_at);
    if v_receipt.delivery_status = 'FAILED' then
      v_error_code := coalesce(v_receipt.error_code, v_error_code);
    end if;
  end loop;

  update public.message_delivery_receipts
  set message_log_id = new.id
  where provider = new.provider
    and provider_message_id = new.provider_message_id
    and message_log_id is null;

  if v_latest is not null then
    update public.message_logs
    set delivery_status = v_status,
        accepted_at = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED')
            then coalesce(accepted_at, sent_at, clock_timestamp())
          else accepted_at
        end,
        delivered_at = case
          when v_status = 'DELIVERED' then coalesce(delivered_at, v_latest)
          else delivered_at
        end,
        last_delivery_receipt_at = greatest(last_delivery_receipt_at, v_latest),
        status = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then 'SENT'
          when v_status = 'FAILED' then 'FAILED'
          else status
        end,
        sent_at = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED')
            then coalesce(sent_at, accepted_at, v_latest, clock_timestamp())
          else sent_at
        end,
        failure_class = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
          when v_status = 'FAILED' then 'PERMANENT'
          else failure_class
        end,
        error_code = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
          when v_status = 'FAILED'
            then left(coalesce(v_error_code, 'PROVIDER_DELIVERY_FAILED'), 80)
          else error_code
        end,
        error_message_sanitized = case
          when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
          else error_message_sanitized
        end,
        next_attempt_at = case when v_status = 'UNKNOWN' then next_attempt_at else null end,
        lease_owner = case when v_status = 'UNKNOWN' then lease_owner else null end,
        lease_until = case when v_status = 'UNKNOWN' then lease_until else null end
    where id = new.id;

    if new.message_type = 'WEEKLY_CHECKIN' then
      update public.weekly_checkin_invitations
      set status = case
            when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then 'SENT'
            when v_status = 'FAILED' then 'FAILED'
            else status
          end,
          sent_at = case
            when v_status in ('ACCEPTED', 'SENT', 'DELIVERED')
              then coalesce(sent_at, v_latest, clock_timestamp())
            else sent_at
          end,
          next_attempt_at = case when v_status = 'UNKNOWN' then next_attempt_at else null end,
          last_error_code = case
            when v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
            when v_status = 'FAILED'
              then left(coalesce(v_error_code, 'PROVIDER_DELIVERY_FAILED'), 80)
            else last_error_code
          end,
          lease_owner = case when v_status = 'UNKNOWN' then lease_owner else null end,
          lease_until = case when v_status = 'UNKNOWN' then lease_until else null end
      where id = new.invitation_id
        and completed_at is null
        and status in ('PENDING', 'SENDING', 'SENT', 'FAILED');
    elsif new.message_type = 'WEEKLY_CHECKIN_REMINDER'
          and v_status in ('ACCEPTED', 'SENT', 'DELIVERED') then
      update public.weekly_checkin_invitations
      set reminder_sent_at = coalesce(reminder_sent_at, v_latest, clock_timestamp())
      where id = new.invitation_id
        and completed_at is null;
    end if;
  end if;
  return null;
end;
$$;

create trigger message_logs_attach_pending_receipts
after insert or update of provider_message_id on public.message_logs
for each row
when (new.provider_message_id is not null)
execute function public.attach_pending_message_delivery_receipts();

create function public.apply_message_delivery_receipt(
  p_provider text,
  p_provider_event_id text,
  p_provider_message_id text,
  p_delivery_status text,
  p_occurred_at timestamptz default null,
  p_signature_timestamp timestamptz default null,
  p_payload_sha256 text default null,
  p_error_code text default null
)
returns table (
  duplicate boolean,
  matched boolean,
  message_log_id uuid,
  delivery_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_message public.message_logs%rowtype;
  v_existing_receipt public.message_delivery_receipts%rowtype;
  v_receipt_id uuid;
  v_next_status text;
begin
  if char_length(p_provider) not between 1 and 40
     or char_length(p_provider_event_id) not between 8 and 160
     or char_length(p_provider_message_id) not between 1 and 200
     or p_delivery_status not in ('ACCEPTED', 'SENT', 'DELIVERED', 'FAILED', 'UNKNOWN')
     or p_signature_timestamp is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or (p_error_code is not null and char_length(p_error_code) not between 1 and 80) then
    raise exception 'invalid_message_delivery_receipt' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'hometogether-message-delivery:' || p_provider || ':' || p_provider_message_id,
    0
  ));

  select * into v_message
  from public.message_logs message
  where message.provider = p_provider
    and message.provider_message_id = p_provider_message_id
  for update;

  insert into public.message_delivery_receipts (
    message_log_id, provider, provider_event_id, provider_message_id,
    delivery_status, occurred_at, signature_timestamp, payload_sha256, error_code
  ) values (
    v_message.id, p_provider, p_provider_event_id, p_provider_message_id,
    p_delivery_status, p_occurred_at, p_signature_timestamp, p_payload_sha256,
    nullif(p_error_code, '')
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is null then
    select * into v_existing_receipt
    from public.message_delivery_receipts receipt
    where receipt.provider = p_provider
      and receipt.provider_event_id = p_provider_event_id;

    -- Only a byte-identical callback is an idempotent retry. A validly signed
    -- payload that reuses an event ID for different message/state data is a
    -- provider contract conflict and must never be acknowledged as a duplicate.
    if v_existing_receipt.id is null
       or v_existing_receipt.provider_message_id <> p_provider_message_id
       or v_existing_receipt.delivery_status <> p_delivery_status
       or v_existing_receipt.payload_sha256 <> p_payload_sha256 then
      raise exception 'message_delivery_event_conflict' using errcode = '23505';
    end if;

    return query
    select true,
           v_existing_receipt.message_log_id is not null,
           v_existing_receipt.message_log_id,
           v_existing_receipt.delivery_status;
    return;
  end if;

  if v_message.id is null then
    return query select false, false, null::uuid, p_delivery_status;
    return;
  end if;

  v_next_status := public.message_delivery_next_status(
    v_message.delivery_status,
    p_delivery_status
  );

  update public.message_logs
  set delivery_status = v_next_status,
      accepted_at = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED')
          then coalesce(accepted_at, sent_at, clock_timestamp())
        else accepted_at
      end,
      delivered_at = case
        when v_next_status = 'DELIVERED'
          then coalesce(delivered_at, p_occurred_at, clock_timestamp())
        else delivered_at
      end,
      last_delivery_receipt_at = clock_timestamp(),
      status = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then 'SENT'
        when v_next_status = 'FAILED' then 'FAILED'
        else status
      end,
      sent_at = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED')
          then coalesce(sent_at, accepted_at, p_occurred_at, clock_timestamp())
        else sent_at
      end,
      failure_class = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
        when v_next_status = 'FAILED' then 'PERMANENT'
        else failure_class
      end,
      error_code = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
        when v_next_status = 'FAILED' then left(coalesce(p_error_code, 'PROVIDER_DELIVERY_FAILED'), 80)
        else error_code
      end,
      error_message_sanitized = case
        when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
        else error_message_sanitized
      end,
      next_attempt_at = case when v_next_status = 'UNKNOWN' then next_attempt_at else null end,
      lease_owner = case when v_next_status = 'UNKNOWN' then lease_owner else null end,
      lease_until = case when v_next_status = 'UNKNOWN' then lease_until else null end
  where id = v_message.id;

  if v_message.message_type = 'WEEKLY_CHECKIN' then
    update public.weekly_checkin_invitations
    set status = case
          when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then 'SENT'
          when v_next_status = 'FAILED' then 'FAILED'
          else status
        end,
        sent_at = case
          when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED')
            then coalesce(sent_at, p_occurred_at, clock_timestamp())
          else sent_at
        end,
        next_attempt_at = case when v_next_status = 'UNKNOWN' then next_attempt_at else null end,
        last_error_code = case
          when v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then null
          when v_next_status = 'FAILED'
            then left(coalesce(p_error_code, 'PROVIDER_DELIVERY_FAILED'), 80)
          else last_error_code
        end,
        lease_owner = case when v_next_status = 'UNKNOWN' then lease_owner else null end,
        lease_until = case when v_next_status = 'UNKNOWN' then lease_until else null end
    where id = v_message.invitation_id
      and completed_at is null
      and status in ('PENDING', 'SENDING', 'SENT', 'FAILED');
  elsif v_message.message_type = 'WEEKLY_CHECKIN_REMINDER'
        and v_next_status in ('ACCEPTED', 'SENT', 'DELIVERED') then
    update public.weekly_checkin_invitations
    set reminder_sent_at = coalesce(reminder_sent_at, p_occurred_at, clock_timestamp())
    where id = v_message.invitation_id
      and completed_at is null;
  end if;

  return query select false, true, v_message.id, v_next_status;
end;
$$;

revoke all on function public.message_delivery_next_status(text, text)
  from public, anon, authenticated;
grant execute on function public.message_delivery_next_status(text, text)
  to service_role;
revoke all on function public.sync_message_delivery_acceptance()
  from public, anon, authenticated;
revoke all on function public.attach_pending_message_delivery_receipts()
  from public, anon, authenticated;
revoke all on function public.complete_message_delivery(
  uuid, text, boolean, text, text, text, boolean, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.complete_message_delivery(
  uuid, text, boolean, text, text, text, boolean, timestamptz, text
) to service_role;
revoke all on function public.apply_message_delivery_receipt(
  text, text, text, text, timestamptz, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.apply_message_delivery_receipt(
  text, text, text, text, timestamptz, timestamptz, text, text
) to service_role;

commit;
