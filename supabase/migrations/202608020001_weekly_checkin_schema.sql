begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  profile_type text not null check (profile_type in ('HOST', 'GUEST', 'ADMIN', 'STAFF')),
  display_name text not null check (char_length(display_name) between 1 and 80),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.phone is
  'E.164 phone number. Never copy this value into message, audit, or webhook logs.';

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  city text,
  district text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete restrict,
  host_id uuid not null references public.profiles(id) on delete restrict,
  guest_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACTIVE', 'MOVE_OUT_SCHEDULED', 'ENDED', 'CANCELLED')),
  move_in_date date not null,
  move_out_date date,
  contract_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (host_id <> guest_id),
  check (move_out_date is null or move_out_date >= move_in_date),
  check (contract_end_date is null or contract_end_date >= move_in_date)
);

create table public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  permissions text[] not null default array['CHECKIN_READ']::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(permissions) > 0),
  check (
    permissions <@ array[
      'CHECKIN_READ', 'SAFETY_READ', 'CASE_WRITE', 'SUPER_ADMIN'
    ]::text[]
  )
);

create table public.weekly_checkin_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  send_at timestamptz not null,
  reminder_at timestamptz,
  expires_at timestamptz not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (week_end = week_start + 6),
  check (expires_at > send_at),
  check (reminder_at is null or reminder_at > send_at)
);

create table public.weekly_checkin_invitations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.weekly_checkin_runs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('HOST', 'GUEST')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'OPENED', 'COMPLETED', 'EXPIRED')),
  send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  sent_at timestamptz,
  reminder_sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, participant_id),
  check (expires_at > created_at),
  check (completed_at is null or status = 'COMPLETED')
);

create table public.weekly_checkin_drafts (
  invitation_id uuid primary key references public.weekly_checkin_invitations(id) on delete cascade,
  questionnaire_version text not null check (char_length(questionnaire_version) between 1 and 40),
  answers_json jsonb not null default '{}'::jsonb check (jsonb_typeof(answers_json) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_checkin_responses (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.weekly_checkin_invitations(id) on delete restrict,
  match_id uuid not null references public.matches(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  role text not null check (role in ('HOST', 'GUEST')),
  questionnaire_version text not null check (char_length(questionnaire_version) between 1 and 40),
  overall_status text not null check (
    overall_status in (
      'VERY_GOOD', 'GOOD', 'SLIGHTLY_UNCOMFORTABLE', 'VERY_UNCOMFORTABLE', 'NEED_HELP_NOW'
    )
  ),
  issue_status text check (
    issue_status is null or issue_status in ('NO_ISSUE', 'RESOLVED', 'UNRESOLVED', 'REPEATED', 'WORSENING')
  ),
  positive_points text[] not null default '{}'::text[],
  desired_support text[] not null default '{}'::text[],
  disclosure_preference text check (
    disclosure_preference is null or disclosure_preference in (
      'OPS_ONLY', 'CONTACT_BEFORE_SHARE', 'SUMMARY_WITHOUT_NAME', 'SHARE_WITH_NAME', 'DO_NOT_SHARE'
    )
  ),
  contact_method text check (
    contact_method is null or contact_method in ('KAKAO', 'PHONE', 'SMS', 'NO_CONTACT')
  ),
  contact_window text check (
    contact_window is null or contact_window in (
      'WEEKDAY_10_12', 'WEEKDAY_12_15', 'WEEKDAY_15_18', 'WEEKDAY_18_20',
      'WEEKEND', 'ANY_TIME', 'NOW'
    )
  ),
  immediate_danger text check (
    immediate_danger is null or immediate_danger in (
      'IMMEDIATE_DANGER', 'CONCERNED_BUT_NOT_IMMEDIATE', 'NOT_IMMEDIATE', 'UNSURE'
    )
  ),
  safe_to_contact text check (
    safe_to_contact is null or safe_to_contact in (
      'PHONE_OK_NOW', 'KAKAO_ONLY', 'SMS_ONLY', 'NOT_SAFE_TO_CONTACT_NOW', 'CONTACT_LATER'
    )
  ),
  safe_location text check (
    safe_location is null or safe_location in ('YES', 'NO', 'UNSURE', 'PREFER_NOT_TO_ANSWER')
  ),
  risk_level text not null check (risk_level in ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
  risk_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_reasons) = 'array'),
  paired_mismatch boolean not null default false,
  answers_json jsonb not null check (jsonb_typeof(answers_json) = 'object'),
  question_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(question_snapshot) = 'object'),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    positive_points <@ array[
      'PRIVACY_RESPECTED', 'COMMUNICATION_GOOD', 'CLEANLINESS_GOOD', 'RULES_FOLLOWED',
      'SHARED_SPACE_GOOD', 'NO_SPECIAL_EVENT', 'SKIP'
    ]::text[]
  ),
  check (
    desired_support <@ array[
      'RECORD_ONLY', 'COMMUNICATION_GUIDE', 'RULE_REMINDER_TO_BOTH', 'ANONYMOUS_SUMMARY',
      'CHAT_MEDIATION', 'PHONE_CONSULT', 'CONTRACT_REVIEW', 'RELOCATION_EXIT_CONSULT',
      'URGENT_CONTACT'
    ]::text[]
  )
);

create table public.weekly_checkin_issues (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.weekly_checkin_responses(id) on delete cascade,
  order_index smallint not null check (order_index between 0 and 2),
  category text not null check (
    category in (
      'CLEANLINESS', 'SHARED_SPACE', 'NOISE_SLEEP', 'HOUSE_RULES', 'PRIVACY_BOUNDARY',
      'COMMUNICATION', 'CARE_PRESSURE', 'PAYMENT_CONTRACT', 'FACILITY_REPAIR', 'SAFETY', 'UNKNOWN'
    )
  ),
  subcategory text not null check (char_length(subcategory) between 1 and 80),
  frequency text not null check (
    frequency in ('ONCE', 'TWO_OR_THREE', 'SEVERAL_TIMES', 'ALMOST_DAILY', 'ONGOING', 'UNKNOWN')
  ),
  severity smallint not null check (severity between 1 and 5),
  discussion_status text not null check (
    discussion_status in (
      'NOT_DISCLOSED', 'DONT_KNOW_HOW', 'DISCUSSED_RESOLVED', 'DISCUSSED_UNRESOLVED',
      'WORSENED_AFTER_DISCUSSION', 'DIFFICULT_TO_DISCUSS'
    )
  ),
  desired_action text not null check (
    desired_action in (
      'RECORD_ONLY', 'COMMUNICATION_GUIDE', 'RULE_REMINDER_TO_BOTH', 'ANONYMOUS_SUMMARY',
      'CHAT_MEDIATION', 'PHONE_CONSULT', 'CONTRACT_REVIEW', 'RELOCATION_EXIT_CONSULT',
      'URGENT_CONTACT'
    )
  ),
  clarification_preference text check (
    clarification_preference is null or clarification_preference in (
      'CONTACT_TO_EXPLAIN', 'RECORD_WITHOUT_DETAILS'
    )
  ),
  additional_note text check (additional_note is null or char_length(additional_note) <= 200),
  created_at timestamptz not null default now(),
  unique (response_id, order_index)
);

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null unique references public.weekly_checkin_responses(id) on delete restrict,
  match_id uuid not null references public.matches(id) on delete restrict,
  participant_id uuid not null references public.profiles(id) on delete restrict,
  priority text not null check (priority in ('GREEN', 'YELLOW', 'ORANGE', 'RED')),
  status text not null default 'UNACKNOWLEDGED' check (
    status in ('UNACKNOWLEDGED', 'OPEN', 'CONTACTED', 'MEDIATING', 'MONITORING', 'RESOLVED', 'CLOSED')
  ),
  assigned_admin_id uuid references public.admin_memberships(user_id) on delete set null,
  acknowledgement_at timestamptz,
  first_contact_at timestamptz,
  resolved_at timestamptz,
  resolution_code text check (resolution_code is null or char_length(resolution_code) <= 80),
  internal_note text check (internal_note is null or char_length(internal_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'UNACKNOWLEDGED' or acknowledgement_at is null)
);

create table public.support_case_events (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases(id) on delete cascade,
  admin_id uuid references public.admin_memberships(user_id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  before_json jsonb check (before_json is null or jsonb_typeof(before_json) = 'object'),
  after_json jsonb check (after_json is null or jsonb_typeof(after_json) = 'object'),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create table public.message_logs (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.weekly_checkin_invitations(id) on delete set null,
  provider text not null check (char_length(provider) between 1 and 40),
  message_type text not null check (
    message_type in ('WEEKLY_CHECKIN', 'WEEKLY_CHECKIN_REMINDER', 'SMS_FALLBACK')
  ),
  recipient_masked text not null check (char_length(recipient_masked) between 3 and 40),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  provider_message_id text,
  status text not null default 'PENDING' check (
    status in ('PENDING', 'SENDING', 'SENT', 'RETRYABLE', 'FAILED')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message_sanitized text check (
    error_message_sanitized is null or char_length(error_message_sanitized) <= 500
  ),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.message_attempts (
  id uuid primary key default gen_random_uuid(),
  message_log_id uuid not null references public.message_logs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('SENT', 'RETRYABLE', 'FAILED')),
  provider_message_id text,
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message_sanitized text check (
    error_message_sanitized is null or char_length(error_message_sanitized) <= 500
  ),
  created_at timestamptz not null default now(),
  unique (message_log_id, attempt_number)
);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default gen_random_uuid() unique,
  event_type text not null check (
    event_type in (
      'weekly_checkin.completed', 'weekly_checkin.risk_detected',
      'support_case.created', 'support_case.updated', 'admin_alert.critical_case'
    )
  ),
  aggregate_type text not null check (aggregate_type in ('RESPONSE', 'SUPPORT_CASE')),
  aggregate_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique check (char_length(dedupe_key) between 8 and 200),
  destination text not null check (destination in ('CRM', 'ADMIN_ALERT')),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'SENDING', 'DELIVERED', 'RETRYABLE', 'FAILED')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  last_http_status integer check (last_http_status is null or last_http_status between 100 and 599),
  last_error_sanitized text check (
    last_error_sanitized is null or char_length(last_error_sanitized) <= 500
  ),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.weekly_checkin_signals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.weekly_checkin_runs(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  participant_id uuid not null references public.profiles(id) on delete cascade,
  invitation_id uuid references public.weekly_checkin_invitations(id) on delete cascade,
  signal_type text not null check (
    signal_type in ('TWO_CONSECUTIVE_NON_RESPONSES', 'REPEATED_SUBCATEGORY', 'PAIRED_MISMATCH')
  ),
  risk_level text not null default 'YELLOW' check (risk_level in ('YELLOW', 'ORANGE', 'RED')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  created_at timestamptz not null default now(),
  unique (run_id, participant_id, signal_type)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_memberships(user_id) on delete set null,
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid not null,
  action text not null check (char_length(action) between 1 and 80),
  before_json jsonb check (before_json is null or jsonb_typeof(before_json) = 'object'),
  after_json jsonb check (after_json is null or jsonb_typeof(after_json) = 'object'),
  created_at timestamptz not null default now()
);

create table public.rate_limit_buckets (
  bucket_key text not null check (char_length(bucket_key) between 16 and 128),
  route text not null check (char_length(route) between 1 and 120),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (bucket_key, route, window_start)
);

create index profiles_auth_user_idx on public.profiles(auth_user_id) where auth_user_id is not null;
create index profiles_phone_idx on public.profiles(phone);
create index matches_status_dates_idx on public.matches(status, move_in_date, move_out_date, contract_end_date);
create index matches_host_idx on public.matches(host_id);
create index matches_guest_idx on public.matches(guest_id);
create index invitations_run_status_expiry_idx
  on public.weekly_checkin_invitations(run_id, status, expires_at);
create index invitations_match_run_idx on public.weekly_checkin_invitations(match_id, run_id);
create index invitations_retry_idx
  on public.weekly_checkin_invitations(status, next_attempt_at)
  where status in ('PENDING', 'FAILED', 'SENDING');
create index responses_risk_submitted_idx
  on public.weekly_checkin_responses(risk_level, submitted_at desc);
create index responses_match_submitted_idx
  on public.weekly_checkin_responses(match_id, submitted_at desc);
create index issues_category_subcategory_idx on public.weekly_checkin_issues(category, subcategory);
create index support_cases_queue_idx on public.support_cases(status, priority, created_at);
create index support_cases_assignee_idx on public.support_cases(assigned_admin_id, status);
create index support_case_events_case_created_idx
  on public.support_case_events(support_case_id, created_at desc);
create index message_logs_dispatch_idx
  on public.message_logs(provider, status, next_attempt_at, created_at)
  where status in ('PENDING', 'RETRYABLE', 'SENDING');
create index outbox_dispatch_idx
  on public.integration_outbox(destination, status, next_attempt_at, created_at)
  where status in ('PENDING', 'RETRYABLE', 'SENDING');
create index signals_participant_idx on public.weekly_checkin_signals(participant_id, created_at desc);
create index audit_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index rate_limit_expiry_idx on public.rate_limit_buckets(expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger homes_set_updated_at before update on public.homes
  for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();
create trigger admin_memberships_set_updated_at before update on public.admin_memberships
  for each row execute function public.set_updated_at();
create trigger weekly_checkin_runs_set_updated_at before update on public.weekly_checkin_runs
  for each row execute function public.set_updated_at();
create trigger weekly_checkin_invitations_set_updated_at before update on public.weekly_checkin_invitations
  for each row execute function public.set_updated_at();
create trigger weekly_checkin_drafts_set_updated_at before update on public.weekly_checkin_drafts
  for each row execute function public.set_updated_at();
create trigger support_cases_set_updated_at before update on public.support_cases
  for each row execute function public.set_updated_at();
create trigger message_logs_set_updated_at before update on public.message_logs
  for each row execute function public.set_updated_at();
create trigger integration_outbox_set_updated_at before update on public.integration_outbox
  for each row execute function public.set_updated_at();

revoke all on function public.set_updated_at() from public, anon, authenticated;

commit;
