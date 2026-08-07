begin;

-- Production hardening is deliberately additive. The existing app_files,
-- app_members, and app_records tables are not renamed, altered, or read here.
do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'profiles',
    'homes',
    'matches',
    'admin_memberships',
    'weekly_checkin_runs',
    'weekly_checkin_invitations',
    'weekly_checkin_responses',
    'weekly_checkin_issues',
    'support_cases',
    'support_case_events',
    'message_logs',
    'message_attempts',
    'integration_outbox',
    'weekly_checkin_signals',
    'audit_logs'
  ]
  loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'weekly_checkin_baseline_missing:%', required_table
        using errcode = '42P01',
              hint = 'Apply the reviewed weekly check-in baseline migrations before this additive migration.';
    end if;
  end loop;
end;
$$;

-- A run flag describes the batch default. Invitation.is_test is authoritative
-- for response/admin statistics because a real weekly run can contain a
-- dedicated test account invitation. Descendants inherit the invitation flag.
alter table public.weekly_checkin_runs
  add column if not exists is_test boolean not null default false;
alter table public.weekly_checkin_invitations
  add column if not exists is_test boolean not null default false;
alter table public.weekly_checkin_responses
  add column if not exists is_test boolean not null default false;
alter table public.weekly_checkin_issues
  add column if not exists is_test boolean not null default false;
alter table public.support_cases
  add column if not exists is_test boolean not null default false;
alter table public.support_case_events
  add column if not exists is_test boolean not null default false;
alter table public.message_logs
  add column if not exists is_test boolean not null default false;
alter table public.message_attempts
  add column if not exists is_test boolean not null default false;
alter table public.integration_outbox
  add column if not exists is_test boolean not null default false;
alter table public.weekly_checkin_signals
  add column if not exists is_test boolean not null default false;

comment on column public.weekly_checkin_invitations.is_test is
  'Authoritative test-data flag. Production statistics must exclude rows where true.';
comment on column public.weekly_checkin_responses.is_test is
  'Inherited from invitation and immutable through direct client input.';
comment on column public.support_cases.is_test is
  'Inherited from response. Test RED cases remain visible to admins but never enqueue external alerts.';

-- Backfill before installing enforcement triggers. Existing rows are production
-- unless a run/invitation has already been explicitly classified as test.
update public.weekly_checkin_invitations invitation
set is_test = invitation.is_test or run.is_test
from public.weekly_checkin_runs run
where run.id = invitation.run_id
  and invitation.is_test is distinct from (invitation.is_test or run.is_test);

update public.weekly_checkin_responses response
set is_test = invitation.is_test
from public.weekly_checkin_invitations invitation
where invitation.id = response.invitation_id
  and response.is_test is distinct from invitation.is_test;

update public.weekly_checkin_issues issue
set is_test = response.is_test
from public.weekly_checkin_responses response
where response.id = issue.response_id
  and issue.is_test is distinct from response.is_test;

update public.support_cases support_case
set is_test = response.is_test
from public.weekly_checkin_responses response
where response.id = support_case.response_id
  and support_case.is_test is distinct from response.is_test;

update public.support_case_events event
set is_test = support_case.is_test
from public.support_cases support_case
where support_case.id = event.support_case_id
  and event.is_test is distinct from support_case.is_test;

update public.message_logs message
set is_test = invitation.is_test
from public.weekly_checkin_invitations invitation
where invitation.id = message.invitation_id
  and message.is_test is distinct from invitation.is_test;

update public.message_attempts attempt
set is_test = message.is_test
from public.message_logs message
where message.id = attempt.message_log_id
  and attempt.is_test is distinct from message.is_test;

update public.weekly_checkin_signals signal
set is_test = coalesce(
  (
    select invitation.is_test
    from public.weekly_checkin_invitations invitation
    where invitation.id = signal.invitation_id
  ),
  (
    select run.is_test
    from public.weekly_checkin_runs run
    where run.id = signal.run_id
  ),
  false
)
where signal.is_test is distinct from coalesce(
  (
    select invitation.is_test
    from public.weekly_checkin_invitations invitation
    where invitation.id = signal.invitation_id
  ),
  (
    select run.is_test
    from public.weekly_checkin_runs run
    where run.id = signal.run_id
  ),
  false
);

create or replace function public.enforce_weekly_checkin_run_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_context_is_test boolean := coalesce(
    nullif(current_setting('hometogether.checkin_is_test', true), ''),
    'false'
  )::boolean;
begin
  if tg_op = 'UPDATE' and old.is_test is distinct from new.is_test then
    raise exception 'weekly_checkin_run_test_flag_is_immutable' using errcode = '23514';
  end if;

  new.is_test := coalesce(new.is_test, false) or v_context_is_test;
  return new;
end;
$$;

create or replace function public.enforce_weekly_checkin_invitation_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_run_is_test boolean;
  v_context_is_test boolean := coalesce(
    nullif(current_setting('hometogether.checkin_is_test', true), ''),
    'false'
  )::boolean;
begin
  if tg_op = 'UPDATE' and old.is_test is distinct from new.is_test then
    raise exception 'weekly_checkin_invitation_test_flag_is_immutable' using errcode = '23514';
  end if;

  select run.is_test into strict v_run_is_test
  from public.weekly_checkin_runs run
  where run.id = new.run_id;

  new.is_test := coalesce(new.is_test, false) or v_run_is_test or v_context_is_test;
  return new;
end;
$$;

create or replace function public.inherit_weekly_checkin_response_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select invitation.is_test into strict new.is_test
  from public.weekly_checkin_invitations invitation
  where invitation.id = new.invitation_id;
  return new;
end;
$$;

create or replace function public.inherit_weekly_checkin_issue_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select response.is_test into strict new.is_test
  from public.weekly_checkin_responses response
  where response.id = new.response_id;
  return new;
end;
$$;

create or replace function public.inherit_support_case_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select response.is_test into strict new.is_test
  from public.weekly_checkin_responses response
  where response.id = new.response_id;
  return new;
end;
$$;

create or replace function public.inherit_support_case_event_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select support_case.is_test into strict new.is_test
  from public.support_cases support_case
  where support_case.id = new.support_case_id;
  return new;
end;
$$;

-- Test invitations must never create a delivery row. Returning NULL from this
-- BEFORE INSERT trigger means message_logs remains exactly zero for test data,
-- so no provider worker can accidentally contact a real counterpart.
create or replace function public.suppress_test_message_log()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_is_test boolean := false;
begin
  if new.invitation_id is not null then
    select invitation.is_test into strict v_is_test
    from public.weekly_checkin_invitations invitation
    where invitation.id = new.invitation_id;
  end if;

  new.is_test := v_is_test;
  if v_is_test then
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.inherit_message_attempt_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  select message.is_test into strict new.is_test
  from public.message_logs message
  where message.id = new.message_log_id;
  return new;
end;
$$;

-- Test submissions can create a test support case for admin E2E verification,
-- but they must never enqueue CRM or ADMIN_ALERT delivery.
create or replace function public.suppress_test_integration_outbox()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_is_test boolean := false;
begin
  if new.aggregate_type = 'RESPONSE' then
    select response.is_test into v_is_test
    from public.weekly_checkin_responses response
    where response.id = new.aggregate_id;
  elsif new.aggregate_type = 'SUPPORT_CASE' then
    select support_case.is_test into v_is_test
    from public.support_cases support_case
    where support_case.id = new.aggregate_id;
  end if;

  new.is_test := coalesce(v_is_test, false);
  if new.is_test then
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.inherit_weekly_checkin_signal_test_flag()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.invitation_id is not null then
    select invitation.is_test into strict new.is_test
    from public.weekly_checkin_invitations invitation
    where invitation.id = new.invitation_id;
  else
    select run.is_test into strict new.is_test
    from public.weekly_checkin_runs run
    where run.id = new.run_id;
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_runs_enforce_test_flag on public.weekly_checkin_runs;
create trigger weekly_runs_enforce_test_flag
  before insert or update of is_test on public.weekly_checkin_runs
  for each row execute function public.enforce_weekly_checkin_run_test_flag();

drop trigger if exists weekly_invitations_enforce_test_flag on public.weekly_checkin_invitations;
create trigger weekly_invitations_enforce_test_flag
  before insert or update of run_id, is_test on public.weekly_checkin_invitations
  for each row execute function public.enforce_weekly_checkin_invitation_test_flag();

drop trigger if exists weekly_responses_inherit_test_flag on public.weekly_checkin_responses;
create trigger weekly_responses_inherit_test_flag
  before insert or update of invitation_id, is_test on public.weekly_checkin_responses
  for each row execute function public.inherit_weekly_checkin_response_test_flag();

drop trigger if exists weekly_issues_inherit_test_flag on public.weekly_checkin_issues;
create trigger weekly_issues_inherit_test_flag
  before insert or update of response_id, is_test on public.weekly_checkin_issues
  for each row execute function public.inherit_weekly_checkin_issue_test_flag();

drop trigger if exists support_cases_inherit_test_flag on public.support_cases;
create trigger support_cases_inherit_test_flag
  before insert or update of response_id, is_test on public.support_cases
  for each row execute function public.inherit_support_case_test_flag();

drop trigger if exists support_case_events_inherit_test_flag on public.support_case_events;
create trigger support_case_events_inherit_test_flag
  before insert or update of support_case_id, is_test on public.support_case_events
  for each row execute function public.inherit_support_case_event_test_flag();

drop trigger if exists message_logs_suppress_test on public.message_logs;
create trigger message_logs_suppress_test
  before insert or update of invitation_id, is_test on public.message_logs
  for each row execute function public.suppress_test_message_log();

drop trigger if exists message_attempts_inherit_test_flag on public.message_attempts;
create trigger message_attempts_inherit_test_flag
  before insert or update of message_log_id, is_test on public.message_attempts
  for each row execute function public.inherit_message_attempt_test_flag();

drop trigger if exists integration_outbox_suppress_test on public.integration_outbox;
create trigger integration_outbox_suppress_test
  before insert or update of aggregate_type, aggregate_id, is_test on public.integration_outbox
  for each row execute function public.suppress_test_integration_outbox();

drop trigger if exists weekly_signals_inherit_test_flag on public.weekly_checkin_signals;
create trigger weekly_signals_inherit_test_flag
  before insert or update of run_id, invitation_id, is_test on public.weekly_checkin_signals
  for each row execute function public.inherit_weekly_checkin_signal_test_flag();

create index if not exists invitations_production_run_status_idx
  on public.weekly_checkin_invitations(run_id, status)
  where not is_test;
create index if not exists invitations_test_created_idx
  on public.weekly_checkin_invitations(created_at desc)
  where is_test;
create index if not exists responses_production_submitted_idx
  on public.weekly_checkin_responses(submitted_at desc, risk_level)
  where not is_test;
create index if not exists responses_test_submitted_idx
  on public.weekly_checkin_responses(submitted_at desc)
  where is_test;
create index if not exists support_cases_production_queue_idx
  on public.support_cases(status, priority, created_at)
  where not is_test;
create index if not exists support_cases_test_created_idx
  on public.support_cases(created_at desc)
  where is_test;

-- Explicit overload for production E2E. The test context reaches the run and
-- invitation BEFORE INSERT triggers before the original batch RPC can enqueue
-- messages. p_provider is intentionally forced to mock for test batches.
create or replace function public.create_weekly_checkin_batch(
  p_week_start date,
  p_week_end date,
  p_send_at timestamptz,
  p_reminder_at timestamptz,
  p_expires_at timestamptz,
  p_candidates jsonb,
  p_provider text,
  p_is_test boolean
)
returns table (
  run_id uuid,
  invitation_id uuid,
  match_id uuid,
  participant_id uuid,
  role text,
  token_hash text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not p_is_test then
    return query
    select batch.run_id, batch.invitation_id, batch.match_id, batch.participant_id,
           batch.role, batch.token_hash
    from public.create_weekly_checkin_batch(
      p_week_start,
      p_week_end,
      p_send_at,
      p_reminder_at,
      p_expires_at,
      p_candidates,
      p_provider
    ) batch;
    return;
  end if;

  if lower(p_provider) <> 'mock' then
    raise exception 'test_checkin_batch_requires_mock_provider' using errcode = '22023';
  end if;

  perform set_config('hometogether.checkin_is_test', 'true', true);
  perform public.create_weekly_checkin_batch(
    p_week_start,
    p_week_end,
    p_send_at,
    p_reminder_at,
    p_expires_at,
    p_candidates,
    p_provider
  );
  perform set_config('hometogether.checkin_is_test', '', true);

  return query
  with candidate_rows as (
    select candidate.participant_id, lower(candidate.token_hash) as token_hash
    from jsonb_to_recordset(p_candidates) as candidate(
      match_id uuid,
      participant_id uuid,
      role text,
      token_hash text
    )
  )
  select invitation.run_id,
         invitation.id,
         invitation.match_id,
         invitation.participant_id,
         invitation.role,
         invitation.token_hash
  from public.weekly_checkin_invitations invitation
  join public.weekly_checkin_runs run on run.id = invitation.run_id
  join candidate_rows candidate
    on candidate.participant_id = invitation.participant_id
   and candidate.token_hash = invitation.token_hash
  where run.week_start = p_week_start
    and invitation.is_test;
end;
$$;

-- Durable production cron outcome log. request_id makes retries idempotent.
create table if not exists public.cron_execution_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  job_name text not null check (
    job_name in ('WEEKLY_CHECKINS', 'CHECKIN_REMINDERS', 'CHECKIN_OUTBOX')
  ),
  status text not null check (status in ('STARTED', 'COMPLETED', 'FAILED')),
  target_count integer not null default 0 check (target_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_code text check (
    error_code is null or char_length(error_code) between 1 and 120
  ),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'STARTED' and finished_at is null)
    or (status in ('COMPLETED', 'FAILED') and finished_at is not null)
  )
);

create index if not exists cron_execution_logs_recent_idx
  on public.cron_execution_logs(started_at desc);
create index if not exists cron_execution_logs_failures_idx
  on public.cron_execution_logs(started_at desc)
  where status = 'FAILED';

drop trigger if exists cron_execution_logs_set_updated_at on public.cron_execution_logs;
create trigger cron_execution_logs_set_updated_at
  before update on public.cron_execution_logs
  for each row execute function public.set_updated_at();

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
     or p_job_name not in ('WEEKLY_CHECKINS', 'CHECKIN_REMINDERS', 'CHECKIN_OUTBOX')
     or p_status not in ('STARTED', 'COMPLETED', 'FAILED')
     or p_target_count < 0
     or p_sent_count < 0
     or p_failed_count < 0
     or (p_error_code is not null and char_length(p_error_code) > 120) then
    raise exception 'invalid_cron_execution_log' using errcode = '22023';
  end if;

  insert into public.cron_execution_logs (
    request_id,
    job_name,
    status,
    target_count,
    sent_count,
    failed_count,
    error_code,
    started_at,
    finished_at
  ) values (
    p_request_id,
    p_job_name,
    p_status,
    p_target_count,
    p_sent_count,
    p_failed_count,
    case when p_status = 'FAILED' then nullif(left(p_error_code, 120), '') else null end,
    clock_timestamp(),
    case when p_status = 'STARTED' then null else clock_timestamp() end
  )
  on conflict (request_id) do update
  set job_name = excluded.job_name,
      status = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.status
        else excluded.status
      end,
      target_count = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.target_count
        else excluded.target_count
      end,
      sent_count = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.sent_count
        else excluded.sent_count
      end,
      failed_count = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.failed_count
        else excluded.failed_count
      end,
      error_code = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.error_code
        else excluded.error_code
      end,
      finished_at = case
        when public.cron_execution_logs.status in ('COMPLETED', 'FAILED')
          then public.cron_execution_logs.finished_at
        else excluded.finished_at
      end
  returning * into v_log;

  return v_log;
end;
$$;

-- One-time bootstrap state survives membership deactivation, preventing a
-- later caller from recreating a super-admin through the bootstrap path.
create table if not exists public.admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  bootstrapped_by uuid not null references auth.users(id) on delete restrict,
  bootstrapped_at timestamptz not null default clock_timestamp()
);

create or replace function public.bootstrap_first_admin(
  p_user_id uuid,
  p_expected_email text
)
returns public.admin_memberships
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actual_email text;
  v_membership public.admin_memberships%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('hometogether-admin-bootstrap', 0));

  if exists (select 1 from public.admin_bootstrap_state)
     or exists (select 1 from public.admin_memberships) then
    raise exception 'admin_bootstrap_already_used' using errcode = '23505';
  end if;

  if p_expected_email is null or char_length(trim(p_expected_email)) not between 3 and 320 then
    raise exception 'invalid_admin_bootstrap_email' using errcode = '22023';
  end if;

  select lower(email) into v_actual_email
  from auth.users
  where id = p_user_id
    and email_confirmed_at is not null;

  if v_actual_email is null
     or v_actual_email <> lower(trim(p_expected_email)) then
    raise exception 'admin_bootstrap_user_mismatch' using errcode = '42501';
  end if;

  insert into public.admin_memberships (user_id, permissions, is_active)
  values (p_user_id, array['SUPER_ADMIN']::text[], true)
  returning * into v_membership;

  insert into public.admin_bootstrap_state (singleton, bootstrapped_by)
  values (true, p_user_id);

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_user_id,
    'ADMIN_MEMBERSHIP',
    p_user_id,
    'BOOTSTRAP_ADMIN',
    null,
    jsonb_build_object('permissions', array['SUPER_ADMIN']::text[], 'isActive', true)
  );

  return v_membership;
end;
$$;

-- Default production-only aggregate. Service code can read is_test directly to
-- label test records, while operational statistics use this view by default.
create or replace view public.weekly_checkin_admin_run_stats
with (security_invoker = true)
as
with invitation_stats as (
  select
    invitation.run_id,
    count(*) filter (where not invitation.is_test) as target_count,
    count(*) filter (where invitation.is_test) as test_invitation_count,
    count(*) filter (where not invitation.is_test and invitation.role = 'HOST') as host_target_count,
    count(*) filter (where not invitation.is_test and invitation.role = 'GUEST') as guest_target_count,
    count(response.id) filter (where not invitation.is_test) as completed_count,
    count(response.id) filter (
      where not invitation.is_test and invitation.role = 'HOST'
    ) as host_completed_count,
    count(response.id) filter (
      where not invitation.is_test and invitation.role = 'GUEST'
    ) as guest_completed_count,
    count(response.id) filter (
      where not invitation.is_test and response.risk_level = 'GREEN'
    ) as green_count,
    count(response.id) filter (
      where not invitation.is_test and response.risk_level = 'YELLOW'
    ) as yellow_count,
    count(response.id) filter (
      where not invitation.is_test and response.risk_level = 'ORANGE'
    ) as orange_count,
    count(response.id) filter (
      where not invitation.is_test and response.risk_level = 'RED'
    ) as red_count
  from public.weekly_checkin_invitations invitation
  left join public.weekly_checkin_responses response
    on response.invitation_id = invitation.id
   and not response.is_test
  group by invitation.run_id
)
select
  run.id as run_id,
  run.week_start,
  run.week_end,
  run.status,
  run.is_test as is_test_run,
  coalesce(stats.target_count, 0) as target_count,
  coalesce(stats.test_invitation_count, 0) as test_invitation_count,
  coalesce(stats.completed_count, 0) as completed_count,
  coalesce(stats.host_target_count, 0) as host_target_count,
  coalesce(stats.host_completed_count, 0) as host_completed_count,
  coalesce(stats.guest_target_count, 0) as guest_target_count,
  coalesce(stats.guest_completed_count, 0) as guest_completed_count,
  coalesce(stats.green_count, 0) as green_count,
  coalesce(stats.yellow_count, 0) as yellow_count,
  coalesce(stats.orange_count, 0) as orange_count,
  coalesce(stats.red_count, 0) as red_count
from public.weekly_checkin_runs run
left join invitation_stats stats on stats.run_id = run.id
where not run.is_test;

alter table public.cron_execution_logs enable row level security;
alter table public.admin_bootstrap_state enable row level security;

create policy cron_execution_logs_select_admin
  on public.cron_execution_logs
  for select to authenticated
  using (public.is_admin('CHECKIN_READ'));

revoke all on table public.cron_execution_logs from public, anon, authenticated;
revoke all on table public.admin_bootstrap_state from public, anon, authenticated;
grant select on table public.cron_execution_logs to authenticated;
grant all on table public.cron_execution_logs to service_role;
grant all on table public.admin_bootstrap_state to service_role;

revoke all on table public.weekly_checkin_admin_run_stats from public, anon, authenticated;
grant select on table public.weekly_checkin_admin_run_stats to authenticated, service_role;

revoke all on function public.enforce_weekly_checkin_run_test_flag() from public, anon, authenticated;
revoke all on function public.enforce_weekly_checkin_invitation_test_flag() from public, anon, authenticated;
revoke all on function public.inherit_weekly_checkin_response_test_flag() from public, anon, authenticated;
revoke all on function public.inherit_weekly_checkin_issue_test_flag() from public, anon, authenticated;
revoke all on function public.inherit_support_case_test_flag() from public, anon, authenticated;
revoke all on function public.inherit_support_case_event_test_flag() from public, anon, authenticated;
revoke all on function public.suppress_test_message_log() from public, anon, authenticated;
revoke all on function public.inherit_message_attempt_test_flag() from public, anon, authenticated;
revoke all on function public.suppress_test_integration_outbox() from public, anon, authenticated;
revoke all on function public.inherit_weekly_checkin_signal_test_flag() from public, anon, authenticated;

revoke all on function public.create_weekly_checkin_batch(
  date, date, timestamptz, timestamptz, timestamptz, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_weekly_checkin_batch(
  date, date, timestamptz, timestamptz, timestamptz, jsonb, text, boolean
) to service_role;

revoke all on function public.record_cron_execution(
  uuid, text, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_cron_execution(
  uuid, text, text, integer, integer, integer, text
) to service_role;

revoke all on function public.bootstrap_first_admin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid, text) to service_role;

commit;
