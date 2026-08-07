begin;

-- This read-only helper is the only RPC intentionally exposed to authenticated
-- users. All mutation/job RPCs below are service-role only.
create or replace function public.is_admin(required_permission text default 'CHECKIN_READ')
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_memberships am
    where am.user_id = auth.uid()
      and am.is_active
      and (
        required_permission = any(am.permissions)
        or 'SUPER_ADMIN' = any(am.permissions)
      )
  );
$$;

create or replace function public.admin_has_permission(
  p_user_id uuid,
  p_required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.admin_memberships am
    where am.user_id = p_user_id
      and am.is_active
      and (
        p_required_permission = any(am.permissions)
        or 'SUPER_ADMIN' = any(am.permissions)
      )
  );
$$;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_route text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_count integer;
begin
  if char_length(p_bucket_key) not between 16 and 128
     or char_length(p_route) not between 1 and 120
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_rate_limit_parameters' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  v_window_end := v_window_start + make_interval(secs => p_window_seconds);

  insert into public.rate_limit_buckets (
    bucket_key, route, window_start, request_count, expires_at
  ) values (
    p_bucket_key, p_route, v_window_start, 1,
    v_window_end + make_interval(secs => p_window_seconds)
  )
  on conflict (bucket_key, route, window_start) do update
    set request_count = public.rate_limit_buckets.request_count + 1,
        expires_at = excluded.expires_at
  returning request_count into v_count;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    v_window_end;
end;
$$;

create or replace function public.purge_expired_rate_limits()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted bigint;
begin
  delete from public.rate_limit_buckets where expires_at < clock_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.consume_checkin_rate_limit(
  p_token_hash text,
  p_ip_hash text,
  p_limit integer default 20,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_allowed boolean;
  v_bucket_key text;
begin
  if lower(p_token_hash) !~ '^[0-9a-f]{64}$'
     or lower(p_ip_hash) !~ '^[0-9a-f]{32,128}$' then
    raise exception 'invalid_checkin_rate_limit_hash' using errcode = '22023';
  end if;

  v_bucket_key := encode(
    extensions.digest(lower(p_token_hash) || ':' || lower(p_ip_hash), 'sha256'),
    'hex'
  );

  select result.allowed into v_allowed
  from public.consume_rate_limit(
    v_bucket_key,
    '/api/checkins/[token]',
    p_limit,
    p_window_seconds
  ) result;

  return coalesce(v_allowed, false);
end;
$$;

create or replace function public.create_weekly_checkin_batch(
  p_week_start date,
  p_week_end date,
  p_send_at timestamptz,
  p_reminder_at timestamptz,
  p_expires_at timestamptz,
  p_candidates jsonb,
  p_provider text default 'mock'
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
#variable_conflict use_column
declare
  v_run_id uuid;
  v_expires_at timestamptz;
begin
  if p_week_end <> p_week_start + 6
     or p_expires_at <= p_send_at
     or p_reminder_at <= p_send_at
     or jsonb_typeof(p_candidates) <> 'array'
     or jsonb_array_length(p_candidates) > 2000
     or char_length(p_provider) not between 1 and 40 then
    raise exception 'invalid_weekly_checkin_batch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('weekly-checkin:' || p_week_start::text, 0));

  insert into public.weekly_checkin_runs (
    week_start, week_end, send_at, reminder_at, expires_at, status
  ) values (
    p_week_start, p_week_end, p_send_at, p_reminder_at, p_expires_at, 'RUNNING'
  )
  on conflict (week_start) do update
    set status = case
      when public.weekly_checkin_runs.status = 'PENDING' then 'RUNNING'
      else public.weekly_checkin_runs.status
    end
  returning id, expires_at into v_run_id, v_expires_at;

  return query
  with candidate_rows as (
    select c.match_id, c.participant_id, upper(c.role) as role, lower(c.token_hash) as token_hash
    from jsonb_to_recordset(p_candidates) as c(
      match_id uuid,
      participant_id uuid,
      role text,
      token_hash text
    )
  ),
  valid_candidates as (
    select distinct on (c.participant_id)
      c.match_id,
      c.participant_id,
      c.role,
      c.token_hash,
      p.phone
    from candidate_rows c
    join public.matches m on m.id = c.match_id
    join public.profiles p on p.id = c.participant_id and p.is_active
    where m.status in ('ACTIVE', 'MOVE_OUT_SCHEDULED')
      and m.move_in_date <= (p_send_at at time zone 'Asia/Seoul')::date
      and (m.move_out_date is null or m.move_out_date >= (p_send_at at time zone 'Asia/Seoul')::date)
      and (m.contract_end_date is null or m.contract_end_date >= (p_send_at at time zone 'Asia/Seoul')::date)
      and (
        (c.role = 'HOST' and c.participant_id = m.host_id)
        or (c.role = 'GUEST' and c.participant_id = m.guest_id)
      )
      and c.token_hash ~ '^[0-9a-f]{64}$'
    order by c.participant_id, c.match_id
  ),
  inserted as (
    insert into public.weekly_checkin_invitations (
      run_id, match_id, participant_id, role, token_hash, status, expires_at
    )
    select
      v_run_id, vc.match_id, vc.participant_id, vc.role, vc.token_hash, 'PENDING', v_expires_at
    from valid_candidates vc
    on conflict (run_id, participant_id) do nothing
    returning
      public.weekly_checkin_invitations.id,
      public.weekly_checkin_invitations.run_id,
      public.weekly_checkin_invitations.match_id,
      public.weekly_checkin_invitations.participant_id,
      public.weekly_checkin_invitations.role,
      public.weekly_checkin_invitations.token_hash
  ),
  queued as (
    insert into public.message_logs (
      invitation_id, provider, message_type, recipient_masked, idempotency_key, status
    )
    select
      i.id,
      p_provider,
      'WEEKLY_CHECKIN',
      '***-****-' || right(regexp_replace(p.phone, '\D', '', 'g'), 4),
      'weekly:' || i.run_id::text || ':' || i.participant_id::text || ':initial',
      'PENDING'
    from inserted i
    join public.profiles p on p.id = i.participant_id
    on conflict (idempotency_key) do nothing
    returning invitation_id
  )
  select i.run_id, i.id, i.match_id, i.participant_id, i.role, i.token_hash
  from inserted i
  join queued q on q.invitation_id = i.id;
end;
$$;

create or replace function public.enqueue_weekly_checkin_reminders(
  p_run_id uuid,
  p_provider text default 'mock'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if char_length(p_provider) not between 1 and 40 then
    raise exception 'invalid_provider' using errcode = '22023';
  end if;

  with inserted as (
    insert into public.message_logs (
      invitation_id, provider, message_type, recipient_masked, idempotency_key, status
    )
    select
      i.id,
      p_provider,
      'WEEKLY_CHECKIN_REMINDER',
      '***-****-' || right(regexp_replace(p.phone, '\D', '', 'g'), 4),
      'weekly:' || i.run_id::text || ':' || i.participant_id::text || ':reminder',
      'PENDING'
    from public.weekly_checkin_invitations i
    join public.weekly_checkin_runs r on r.id = i.run_id
    join public.profiles p on p.id = i.participant_id
    left join public.weekly_checkin_responses response on response.invitation_id = i.id
    where i.run_id = p_run_id
      and r.reminder_at is not null
      and r.reminder_at <= clock_timestamp()
      and i.expires_at > clock_timestamp()
      and i.sent_at is not null
      and i.reminder_sent_at is null
      and i.completed_at is null
      and response.id is null
    on conflict (idempotency_key) do nothing
    returning id
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

create or replace function public.claim_message_deliveries(
  p_provider text,
  p_lease_owner text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns table (
  message_log_id uuid,
  invitation_id uuid,
  message_type text,
  idempotency_key text,
  participant_id uuid,
  recipient_name text,
  phone text,
  participant_role text,
  week_start date,
  week_end date,
  expires_at timestamptz,
  token_hash text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if char_length(p_provider) not between 1 and 40
     or char_length(p_lease_owner) not between 8 and 120
     or p_limit not between 1 and 500
     or p_lease_seconds not between 15 and 900 then
    raise exception 'invalid_delivery_claim' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select ml.id
    from public.message_logs ml
    join public.weekly_checkin_invitations i on i.id = ml.invitation_id
    where ml.provider = p_provider
      and (
        ml.status in ('PENDING', 'RETRYABLE')
        or (ml.status = 'SENDING' and ml.lease_until < clock_timestamp())
      )
      and (ml.next_attempt_at is null or ml.next_attempt_at <= clock_timestamp())
      and i.completed_at is null
      and i.expires_at > clock_timestamp()
    order by ml.created_at, ml.id
    for update of ml skip locked
    limit p_limit
  ),
  claimed as (
    update public.message_logs ml
    set status = 'SENDING',
        lease_owner = p_lease_owner,
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        attempt_count = ml.attempt_count + 1
    from candidates c
    where ml.id = c.id
    returning ml.*
  ),
  touched_invitations as (
    update public.weekly_checkin_invitations i
    set status = case
          when c.message_type = 'WEEKLY_CHECKIN' then 'SENDING'
          else i.status
        end,
        send_attempt_count = case
          when c.message_type = 'WEEKLY_CHECKIN' then i.send_attempt_count + 1
          else i.send_attempt_count
        end,
        lease_owner = case
          when c.message_type = 'WEEKLY_CHECKIN' then p_lease_owner
          else i.lease_owner
        end,
        lease_until = case
          when c.message_type = 'WEEKLY_CHECKIN'
            then clock_timestamp() + make_interval(secs => p_lease_seconds)
          else i.lease_until
        end
    from claimed c
    where i.id = c.invitation_id
    returning i.id
  )
  select
    c.id,
    i.id,
    c.message_type,
    c.idempotency_key,
    i.participant_id,
    p.display_name,
    p.phone,
    i.role,
    r.week_start,
    r.week_end,
    i.expires_at,
    i.token_hash
  from claimed c
  join public.weekly_checkin_invitations i on i.id = c.invitation_id
  join touched_invitations ti on ti.id = i.id
  join public.profiles p on p.id = i.participant_id
  join public.weekly_checkin_runs r on r.id = i.run_id;
end;
$$;

create or replace function public.complete_message_delivery(
  p_message_log_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message_sanitized text default null,
  p_retryable boolean default false,
  p_next_attempt_at timestamptz default null
)
returns public.message_logs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_log public.message_logs%rowtype;
  v_result_status text;
begin
  select * into v_log
  from public.message_logs
  where id = p_message_log_id
  for update;

  if not found then
    raise exception 'message_log_not_found' using errcode = 'P0002';
  end if;

  if v_log.status = 'SENT' and p_success then
    return v_log;
  end if;

  if v_log.status <> 'SENDING' or v_log.lease_owner is distinct from p_lease_owner then
    raise exception 'message_delivery_lease_mismatch' using errcode = '55000';
  end if;

  v_result_status := case
    when p_success then 'SENT'
    when p_retryable then 'RETRYABLE'
    else 'FAILED'
  end;

  insert into public.message_attempts (
    message_log_id, attempt_number, status, provider_message_id, error_code, error_message_sanitized
  ) values (
    v_log.id,
    v_log.attempt_count,
    v_result_status,
    p_provider_message_id,
    left(p_error_code, 80),
    left(p_error_message_sanitized, 500)
  )
  on conflict (message_log_id, attempt_number) do nothing;

  update public.message_logs
  set status = v_result_status,
      provider_message_id = case when p_success then p_provider_message_id else provider_message_id end,
      error_code = case when p_success then null else left(p_error_code, 80) end,
      error_message_sanitized = case
        when p_success then null else left(p_error_message_sanitized, 500)
      end,
      sent_at = case when p_success then clock_timestamp() else sent_at end,
      next_attempt_at = case when not p_success and p_retryable then p_next_attempt_at else null end,
      lease_owner = null,
      lease_until = null
  where id = v_log.id
  returning * into v_log;

  if v_log.message_type = 'WEEKLY_CHECKIN' then
    update public.weekly_checkin_invitations
    set status = case when p_success then 'SENT' else 'FAILED' end,
        sent_at = case when p_success then clock_timestamp() else sent_at end,
        next_attempt_at = case when not p_success and p_retryable then p_next_attempt_at else null end,
        last_error_code = case when p_success then null else left(p_error_code, 80) end,
        lease_owner = null,
        lease_until = null
    where id = v_log.invitation_id
      and completed_at is null;
  elsif v_log.message_type = 'WEEKLY_CHECKIN_REMINDER' and p_success then
    update public.weekly_checkin_invitations
    set reminder_sent_at = coalesce(reminder_sent_at, clock_timestamp())
    where id = v_log.invitation_id
      and completed_at is null;
  end if;

  return v_log;
end;
$$;

create or replace function public.save_weekly_checkin_draft(
  p_invitation_id uuid,
  p_token_hash text,
  p_questionnaire_version text,
  p_answers jsonb
)
returns public.weekly_checkin_drafts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invitation public.weekly_checkin_invitations%rowtype;
  v_draft public.weekly_checkin_drafts%rowtype;
begin
  if jsonb_typeof(p_answers) <> 'object'
     or char_length(p_questionnaire_version) not between 1 and 40 then
    raise exception 'invalid_draft' using errcode = '22023';
  end if;

  select * into v_invitation
  from public.weekly_checkin_invitations
  where id = p_invitation_id and token_hash = lower(p_token_hash)
  for update;

  if not found then
    raise exception 'checkin_invitation_not_found' using errcode = 'P0002';
  end if;
  if v_invitation.expires_at <= clock_timestamp() then
    raise exception 'checkin_invitation_expired' using errcode = '22023';
  end if;
  if v_invitation.completed_at is not null then
    raise exception 'checkin_invitation_completed' using errcode = '23505';
  end if;

  insert into public.weekly_checkin_drafts (
    invitation_id, questionnaire_version, answers_json, revision
  ) values (
    v_invitation.id, p_questionnaire_version, p_answers, 1
  )
  on conflict (invitation_id) do update
    set questionnaire_version = excluded.questionnaire_version,
        answers_json = excluded.answers_json,
        revision = public.weekly_checkin_drafts.revision + 1
  returning * into v_draft;

  update public.weekly_checkin_invitations
  set opened_at = coalesce(opened_at, clock_timestamp()),
      status = case
        when status in ('PENDING', 'SENDING', 'SENT', 'FAILED') then 'OPENED'
        else status
      end
  where id = v_invitation.id;

  return v_draft;
end;
$$;

create or replace function public.submit_weekly_checkin(
  p_invitation_id uuid,
  p_token_hash text,
  p_submission jsonb,
  p_risk_level text,
  p_risk_reasons jsonb,
  p_paired_mismatch boolean default false
)
returns table (
  response_id uuid,
  support_case_id uuid,
  already_completed boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invitation public.weekly_checkin_invitations%rowtype;
  v_response_id uuid;
  v_case_id uuid;
  v_issue_count integer;
  v_requires_red boolean;
  v_questionnaire_version text;
begin
  if jsonb_typeof(p_submission) <> 'object'
     or jsonb_typeof(p_risk_reasons) <> 'array'
     or p_risk_level not in ('GREEN', 'YELLOW', 'ORANGE', 'RED') then
    raise exception 'invalid_checkin_submission' using errcode = '22023';
  end if;

  v_questionnaire_version := p_submission ->> 'questionnaireVersion';
  v_issue_count := jsonb_array_length(coalesce(p_submission -> 'issues', '[]'::jsonb));

  if char_length(v_questionnaire_version) not between 1 and 40
     or v_issue_count > 3
     or jsonb_typeof(coalesce(p_submission -> 'positivePoints', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_submission -> 'questionSnapshot', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_checkin_submission_shape' using errcode = '22023';
  end if;

  select * into v_invitation
  from public.weekly_checkin_invitations
  where id = p_invitation_id and token_hash = lower(p_token_hash)
  for update;

  if not found then
    raise exception 'checkin_invitation_not_found' using errcode = 'P0002';
  end if;

  if v_invitation.completed_at is not null then
    select r.id, sc.id into v_response_id, v_case_id
    from public.weekly_checkin_responses r
    left join public.support_cases sc on sc.response_id = r.id
    where r.invitation_id = v_invitation.id;

    return query select v_response_id, v_case_id, true;
    return;
  end if;

  if v_invitation.expires_at <= clock_timestamp() then
    raise exception 'checkin_invitation_expired' using errcode = '22023';
  end if;

  select
    (p_submission ->> 'overallStatus') = 'NEED_HELP_NOW'
    or (p_submission #>> '{safety,immediateDanger}') = 'IMMEDIATE_DANGER'
    or exists (
      select 1
      from jsonb_array_elements(coalesce(p_submission -> 'issues', '[]'::jsonb)) issue
      where issue ->> 'category' = 'SAFETY'
         or (issue ->> 'severity')::integer = 5
         or issue ->> 'subcategory' in (
           'SEXUAL_REMARK_OR_BEHAVIOR', 'UNWANTED_PHYSICAL_CONTACT',
           'PHYSICAL_THREAT_VIOLENCE', 'AFRAID_TO_STAY'
         )
    )
  into v_requires_red;

  if v_requires_red and p_risk_level <> 'RED' then
    raise exception 'safety_response_must_be_red' using errcode = '23514';
  end if;

  insert into public.weekly_checkin_responses (
    invitation_id,
    match_id,
    participant_id,
    role,
    questionnaire_version,
    overall_status,
    issue_status,
    positive_points,
    desired_support,
    disclosure_preference,
    contact_method,
    contact_window,
    immediate_danger,
    safe_to_contact,
    safe_location,
    risk_level,
    risk_reasons,
    paired_mismatch,
    answers_json,
    question_snapshot
  ) values (
    v_invitation.id,
    v_invitation.match_id,
    v_invitation.participant_id,
    v_invitation.role,
    v_questionnaire_version,
    p_submission ->> 'overallStatus',
    p_submission ->> 'issueStatus',
    array(
      select jsonb_array_elements_text(coalesce(p_submission -> 'positivePoints', '[]'::jsonb))
    ),
    array(
      select distinct issue ->> 'desiredAction'
      from jsonb_array_elements(coalesce(p_submission -> 'issues', '[]'::jsonb)) issue
      where issue ? 'desiredAction'
    ),
    p_submission ->> 'disclosurePreference',
    p_submission ->> 'contactMethod',
    p_submission ->> 'contactWindow',
    p_submission #>> '{safety,immediateDanger}',
    p_submission #>> '{safety,safeToContact}',
    p_submission #>> '{safety,safeLocation}',
    p_risk_level,
    p_risk_reasons,
    p_paired_mismatch,
    p_submission,
    coalesce(p_submission -> 'questionSnapshot', '{}'::jsonb)
  )
  returning id into v_response_id;

  insert into public.weekly_checkin_issues (
    response_id,
    order_index,
    category,
    subcategory,
    frequency,
    severity,
    discussion_status,
    desired_action,
    clarification_preference,
    additional_note
  )
  select
    v_response_id,
    (item.ordinality - 1)::smallint,
    item.issue ->> 'category',
    item.issue ->> 'subcategory',
    item.issue ->> 'frequency',
    (item.issue ->> 'severity')::smallint,
    item.issue ->> 'discussionStatus',
    item.issue ->> 'desiredAction',
    item.issue ->> 'clarificationPreference',
    item.issue ->> 'additionalNote'
  from jsonb_array_elements(coalesce(p_submission -> 'issues', '[]'::jsonb))
    with ordinality as item(issue, ordinality);

  update public.weekly_checkin_invitations
  set status = 'COMPLETED',
      completed_at = clock_timestamp(),
      lease_owner = null,
      lease_until = null
  where id = v_invitation.id;

  delete from public.weekly_checkin_drafts where invitation_id = v_invitation.id;

  if p_paired_mismatch then
    update public.weekly_checkin_responses response
    set paired_mismatch = true
    where response.match_id = v_invitation.match_id
      and exists (
        select 1
        from public.weekly_checkin_invitations other_invitation
        where other_invitation.id = response.invitation_id
          and other_invitation.run_id = v_invitation.run_id
      );

    insert into public.weekly_checkin_signals (
      run_id, match_id, participant_id, invitation_id, signal_type, risk_level, reasons
    ) values (
      v_invitation.run_id,
      v_invitation.match_id,
      v_invitation.participant_id,
      v_invitation.id,
      'PAIRED_MISMATCH',
      case when p_risk_level = 'GREEN' then 'YELLOW' else p_risk_level end,
      '["PAIRED_RISK_MISMATCH"]'::jsonb
    ) on conflict (run_id, participant_id, signal_type) do nothing;
  end if;

  if p_risk_level = 'RED' then
    insert into public.support_cases (
      response_id, match_id, participant_id, priority, status
    ) values (
      v_response_id, v_invitation.match_id, v_invitation.participant_id, 'RED', 'UNACKNOWLEDGED'
    )
    on conflict on constraint support_cases_response_id_key
      do update set response_id = excluded.response_id
    returning id into v_case_id;
  end if;

  insert into public.integration_outbox (
    event_type, aggregate_type, aggregate_id, payload, dedupe_key, destination
  ) values (
    'weekly_checkin.completed',
    'RESPONSE',
    v_response_id,
    jsonb_build_object(
      'responseId', v_response_id,
      'matchId', v_invitation.match_id,
      'participantId', v_invitation.participant_id,
      'role', v_invitation.role,
      'riskLevel', p_risk_level,
      'submittedAt', clock_timestamp()
    ),
    'weekly_checkin.completed:' || v_response_id::text,
    'CRM'
  ) on conflict (dedupe_key) do nothing;

  if p_risk_level <> 'GREEN' then
    insert into public.integration_outbox (
      event_type, aggregate_type, aggregate_id, payload, dedupe_key, destination
    ) values (
      'weekly_checkin.risk_detected',
      'RESPONSE',
      v_response_id,
      jsonb_build_object(
        'responseId', v_response_id,
        'matchId', v_invitation.match_id,
        'participantId', v_invitation.participant_id,
        'role', v_invitation.role,
        'riskLevel', p_risk_level
      ),
      'weekly_checkin.risk_detected:' || v_response_id::text,
      'CRM'
    ) on conflict (dedupe_key) do nothing;
  end if;

  if v_case_id is not null then
    insert into public.integration_outbox (
      event_type, aggregate_type, aggregate_id, payload, dedupe_key, destination
    ) values
    (
      'support_case.created',
      'SUPPORT_CASE',
      v_case_id,
      jsonb_build_object('caseId', v_case_id, 'priority', 'RED', 'status', 'UNACKNOWLEDGED'),
      'support_case.created:' || v_case_id::text,
      'CRM'
    ),
    (
      'admin_alert.critical_case',
      'SUPPORT_CASE',
      v_case_id,
      jsonb_build_object('caseId', v_case_id, 'priority', 'RED', 'status', 'UNACKNOWLEDGED'),
      'admin_alert.critical_case:' || v_case_id::text,
      'ADMIN_ALERT'
    )
    on conflict (dedupe_key) do nothing;
  end if;

  return query select v_response_id, v_case_id, false;
end;
$$;

-- Stable PostgREST entry point used by the server repository. The invitation
-- id never has to be accepted from the browser-facing route.
create or replace function public.submit_weekly_checkin(
  p_token_hash text,
  p_submission jsonb,
  p_risk_level text,
  p_risk_reasons jsonb,
  p_paired_mismatch boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invitation_id uuid;
  v_result record;
begin
  select invitation.id into v_invitation_id
  from public.weekly_checkin_invitations invitation
  where invitation.token_hash = lower(p_token_hash);

  if v_invitation_id is null then
    raise exception 'checkin_invitation_not_found' using errcode = 'P0002';
  end if;

  select * into v_result
  from public.submit_weekly_checkin(
    v_invitation_id,
    lower(p_token_hash),
    p_submission,
    p_risk_level,
    p_risk_reasons,
    p_paired_mismatch
  );

  return jsonb_build_object(
    'responseId', v_result.response_id,
    'supportCaseId', v_result.support_case_id,
    'alreadyCompleted', v_result.already_completed
  );
end;
$$;

create or replace function public.admin_update_support_case(
  p_case_id uuid,
  p_admin_id uuid,
  p_action text,
  p_assigned_admin_id uuid default null,
  p_resolution_code text default null,
  p_internal_note text default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before public.support_cases%rowtype;
  v_after public.support_cases%rowtype;
  v_event_id uuid := gen_random_uuid();
  v_before_safe jsonb;
  v_after_safe jsonb;
begin
  if not public.admin_has_permission(p_admin_id, 'CASE_WRITE') then
    raise exception 'admin_case_write_forbidden' using errcode = '42501';
  end if;

  if p_action not in (
    'ACKNOWLEDGE', 'ASSIGN', 'KAKAO_PLANNED', 'PHONE_COMPLETED', 'RULE_GUIDANCE',
    'START_MEDIATION', 'CONTRACT_CONSULT', 'MONITOR', 'RESOLVE', 'CLOSE'
  ) then
    raise exception 'invalid_support_case_action' using errcode = '22023';
  end if;

  if p_action = 'ASSIGN' and (
    p_assigned_admin_id is null
    or not public.admin_has_permission(p_assigned_admin_id, 'CASE_WRITE')
  ) then
    raise exception 'invalid_support_case_assignee' using errcode = '22023';
  end if;

  select * into v_before
  from public.support_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'support_case_not_found' using errcode = 'P0002';
  end if;

  update public.support_cases
  set status = case p_action
        when 'ACKNOWLEDGE' then case when status = 'UNACKNOWLEDGED' then 'OPEN' else status end
        when 'PHONE_COMPLETED' then 'CONTACTED'
        when 'RULE_GUIDANCE' then 'CONTACTED'
        when 'START_MEDIATION' then 'MEDIATING'
        when 'CONTRACT_CONSULT' then 'CONTACTED'
        when 'MONITOR' then 'MONITORING'
        when 'RESOLVE' then 'RESOLVED'
        when 'CLOSE' then 'CLOSED'
        else status
      end,
      assigned_admin_id = case
        when p_action = 'ASSIGN' then p_assigned_admin_id
        else assigned_admin_id
      end,
      acknowledgement_at = case
        when p_action = 'ACKNOWLEDGE' then coalesce(acknowledgement_at, clock_timestamp())
        else acknowledgement_at
      end,
      first_contact_at = case
        when p_action in ('PHONE_COMPLETED', 'RULE_GUIDANCE', 'CONTRACT_CONSULT')
          then coalesce(first_contact_at, clock_timestamp())
        else first_contact_at
      end,
      resolved_at = case
        when p_action in ('RESOLVE', 'CLOSE') then coalesce(resolved_at, clock_timestamp())
        else resolved_at
      end,
      resolution_code = case
        when p_resolution_code is not null then left(p_resolution_code, 80)
        else resolution_code
      end,
      internal_note = case
        when p_internal_note is not null then left(p_internal_note, 1000)
        else internal_note
      end
  where id = p_case_id
  returning * into v_after;

  v_before_safe := jsonb_build_object(
    'status', v_before.status,
    'assignedAdminId', v_before.assigned_admin_id,
    'acknowledgementAt', v_before.acknowledgement_at,
    'firstContactAt', v_before.first_contact_at,
    'resolvedAt', v_before.resolved_at,
    'resolutionCode', v_before.resolution_code
  );
  v_after_safe := jsonb_build_object(
    'status', v_after.status,
    'assignedAdminId', v_after.assigned_admin_id,
    'acknowledgementAt', v_after.acknowledgement_at,
    'firstContactAt', v_after.first_contact_at,
    'resolvedAt', v_after.resolved_at,
    'resolutionCode', v_after.resolution_code
  );

  insert into public.support_case_events (
    id, support_case_id, admin_id, action, before_json, after_json, note
  ) values (
    v_event_id, p_case_id, p_admin_id, p_action, v_before_safe, v_after_safe,
    case when p_internal_note is null then null else left(p_internal_note, 1000) end
  );

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_admin_id, 'SUPPORT_CASE', p_case_id, p_action, v_before_safe, v_after_safe
  );

  insert into public.integration_outbox (
    event_type, aggregate_type, aggregate_id, payload, dedupe_key, destination
  ) values (
    'support_case.updated',
    'SUPPORT_CASE',
    p_case_id,
    jsonb_build_object(
      'caseId', p_case_id,
      'status', v_after.status,
      'priority', v_after.priority,
      'action', p_action,
      'eventId', v_event_id
    ),
    'support_case.updated:' || v_event_id::text,
    'CRM'
  );

  return v_after;
end;
$$;

create or replace function public.claim_outbox_events(
  p_destination text,
  p_lease_owner text,
  p_limit integer default 50,
  p_lease_seconds integer default 120
)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_destination not in ('CRM', 'ADMIN_ALERT')
     or char_length(p_lease_owner) not between 8 and 120
     or p_limit not between 1 and 500
     or p_lease_seconds not between 15 and 900 then
    raise exception 'invalid_outbox_claim' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from public.integration_outbox o
    where o.destination = p_destination
      and (
        o.status in ('PENDING', 'RETRYABLE')
        or (o.status = 'SENDING' and o.lease_until < clock_timestamp())
      )
      and (o.next_attempt_at is null or o.next_attempt_at <= clock_timestamp())
    order by o.created_at, o.id
    for update of o skip locked
    limit p_limit
  )
  update public.integration_outbox o
  set status = 'SENDING',
      lease_owner = p_lease_owner,
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      attempt_count = o.attempt_count + 1
  from candidates c
  where o.id = c.id
  returning o.*;
end;
$$;

create or replace function public.complete_outbox_event(
  p_outbox_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_http_status integer default null,
  p_error_sanitized text default null,
  p_retryable boolean default false,
  p_next_attempt_at timestamptz default null
)
returns public.integration_outbox
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event public.integration_outbox%rowtype;
begin
  select * into v_event
  from public.integration_outbox
  where id = p_outbox_id
  for update;

  if not found then
    raise exception 'outbox_event_not_found' using errcode = 'P0002';
  end if;
  if v_event.status = 'DELIVERED' and p_success then
    return v_event;
  end if;
  if v_event.status <> 'SENDING' or v_event.lease_owner is distinct from p_lease_owner then
    raise exception 'outbox_lease_mismatch' using errcode = '55000';
  end if;

  update public.integration_outbox
  set status = case
        when p_success then 'DELIVERED'
        when p_retryable then 'RETRYABLE'
        else 'FAILED'
      end,
      last_http_status = p_http_status,
      last_error_sanitized = case when p_success then null else left(p_error_sanitized, 500) end,
      delivered_at = case when p_success then clock_timestamp() else delivered_at end,
      next_attempt_at = case when not p_success and p_retryable then p_next_attempt_at else null end,
      lease_owner = null,
      lease_until = null
  where id = p_outbox_id
  returning * into v_event;

  return v_event;
end;
$$;

create or replace function public.refresh_nonresponse_signals(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  with current_invitations as (
    select i.*
    from public.weekly_checkin_invitations i
    where i.run_id = p_run_id
  ),
  eligible as (
    select current_i.*
    from current_invitations current_i
    where 2 = (
      select count(*)::integer
      from (
        select previous_i.completed_at, previous_i.expires_at
        from public.weekly_checkin_invitations previous_i
        join public.weekly_checkin_runs previous_r on previous_r.id = previous_i.run_id
        join public.weekly_checkin_runs current_r on current_r.id = current_i.run_id
        where previous_i.participant_id = current_i.participant_id
          and previous_r.week_start < current_r.week_start
        order by previous_r.week_start desc
        limit 2
      ) previous_two
      where previous_two.completed_at is null
        and previous_two.expires_at <= clock_timestamp()
    )
  ),
  inserted as (
    insert into public.weekly_checkin_signals (
      run_id, match_id, participant_id, invitation_id, signal_type, risk_level, reasons
    )
    select
      e.run_id,
      e.match_id,
      e.participant_id,
      e.id,
      'TWO_CONSECUTIVE_NON_RESPONSES',
      'YELLOW',
      '["TWO_CONSECUTIVE_NON_RESPONSES"]'::jsonb
    from eligible e
    on conflict (run_id, participant_id, signal_type) do nothing
    returning id
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

-- Row-level access. Anonymous check-in access is intentionally absent: every
-- token operation goes through a server route and one of the service-only RPCs.
alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.matches enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.weekly_checkin_runs enable row level security;
alter table public.weekly_checkin_invitations enable row level security;
alter table public.weekly_checkin_drafts enable row level security;
alter table public.weekly_checkin_responses enable row level security;
alter table public.weekly_checkin_issues enable row level security;
alter table public.support_cases enable row level security;
alter table public.support_case_events enable row level security;
alter table public.message_logs enable row level security;
alter table public.message_attempts enable row level security;
alter table public.integration_outbox enable row level security;
alter table public.weekly_checkin_signals enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;

create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin('CHECKIN_READ'));

create policy homes_select_admin on public.homes
  for select to authenticated using (public.is_admin('CHECKIN_READ'));
create policy matches_select_admin on public.matches
  for select to authenticated using (public.is_admin('CHECKIN_READ'));

create policy admin_memberships_select_self on public.admin_memberships
  for select to authenticated using (user_id = auth.uid());

create policy weekly_runs_select_admin on public.weekly_checkin_runs
  for select to authenticated using (public.is_admin('CHECKIN_READ'));
create policy weekly_invitations_select_admin on public.weekly_checkin_invitations
  for select to authenticated using (public.is_admin('CHECKIN_READ'));

create policy weekly_responses_select_authorized_admin on public.weekly_checkin_responses
  for select to authenticated
  using (
    public.is_admin('SAFETY_READ')
    or (
      public.is_admin('CHECKIN_READ')
      and risk_level <> 'RED'
      and immediate_danger is null
      and safe_to_contact is null
      and safe_location is null
    )
  );

create policy weekly_issues_select_authorized_admin on public.weekly_checkin_issues
  for select to authenticated
  using (
    exists (
      select 1 from public.weekly_checkin_responses response
      where response.id = response_id
    )
  );

create policy support_cases_select_safety_admin on public.support_cases
  for select to authenticated using (public.is_admin('SAFETY_READ'));
create policy support_case_events_select_safety_admin on public.support_case_events
  for select to authenticated using (public.is_admin('SAFETY_READ'));

create policy message_logs_select_admin on public.message_logs
  for select to authenticated using (public.is_admin('CHECKIN_READ'));
create policy message_attempts_select_admin on public.message_attempts
  for select to authenticated
  using (
    public.is_admin('CHECKIN_READ')
    and exists (
      select 1 from public.message_logs log where log.id = message_log_id
    )
  );

create policy weekly_signals_select_admin on public.weekly_checkin_signals
  for select to authenticated using (public.is_admin('CHECKIN_READ'));
create policy audit_logs_select_safety_admin on public.audit_logs
  for select to authenticated using (public.is_admin('SAFETY_READ'));

-- Preserve grants on pre-existing production tables such as app_records.
-- This feature changes privileges only on the tables it owns.
revoke all on table
  public.profiles,
  public.homes,
  public.matches,
  public.admin_memberships,
  public.weekly_checkin_runs,
  public.weekly_checkin_invitations,
  public.weekly_checkin_drafts,
  public.weekly_checkin_responses,
  public.weekly_checkin_issues,
  public.support_cases,
  public.support_case_events,
  public.message_logs,
  public.message_attempts,
  public.integration_outbox,
  public.weekly_checkin_signals,
  public.audit_logs,
  public.rate_limit_buckets
from anon, authenticated;
grant select on
  public.profiles,
  public.homes,
  public.matches,
  public.admin_memberships,
  public.weekly_checkin_runs,
  public.weekly_checkin_invitations,
  public.weekly_checkin_responses,
  public.weekly_checkin_issues,
  public.support_cases,
  public.support_case_events,
  public.message_logs,
  public.message_attempts,
  public.weekly_checkin_signals,
  public.audit_logs
to authenticated;

grant all on table
  public.profiles,
  public.homes,
  public.matches,
  public.admin_memberships,
  public.weekly_checkin_runs,
  public.weekly_checkin_invitations,
  public.weekly_checkin_drafts,
  public.weekly_checkin_responses,
  public.weekly_checkin_issues,
  public.support_cases,
  public.support_case_events,
  public.message_logs,
  public.message_attempts,
  public.integration_outbox,
  public.weekly_checkin_signals,
  public.audit_logs,
  public.rate_limit_buckets
to service_role;

revoke all on function public.is_admin(text) from public, anon;
grant execute on function public.is_admin(text) to authenticated, service_role;

revoke all on function public.admin_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_checkin_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.purge_expired_rate_limits() from public, anon, authenticated;
revoke all on function public.create_weekly_checkin_batch(date, date, timestamptz, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.enqueue_weekly_checkin_reminders(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_message_deliveries(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_message_delivery(uuid, text, boolean, text, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.save_weekly_checkin_draft(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.submit_weekly_checkin(uuid, text, jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.submit_weekly_checkin(text, jsonb, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.admin_update_support_case(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_outbox_events(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_outbox_event(uuid, text, boolean, integer, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.refresh_nonresponse_signals(uuid) from public, anon, authenticated;

grant execute on function public.admin_has_permission(uuid, text) to service_role;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.consume_checkin_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.purge_expired_rate_limits() to service_role;
grant execute on function public.create_weekly_checkin_batch(date, date, timestamptz, timestamptz, timestamptz, jsonb, text) to service_role;
grant execute on function public.enqueue_weekly_checkin_reminders(uuid, text) to service_role;
grant execute on function public.claim_message_deliveries(text, text, integer, integer) to service_role;
grant execute on function public.complete_message_delivery(uuid, text, boolean, text, text, text, boolean, timestamptz) to service_role;
grant execute on function public.save_weekly_checkin_draft(uuid, text, text, jsonb) to service_role;
grant execute on function public.submit_weekly_checkin(uuid, text, jsonb, text, jsonb, boolean) to service_role;
grant execute on function public.submit_weekly_checkin(text, jsonb, text, jsonb, boolean) to service_role;
grant execute on function public.admin_update_support_case(uuid, uuid, text, uuid, text, text) to service_role;
grant execute on function public.claim_outbox_events(text, text, integer, integer) to service_role;
grant execute on function public.complete_outbox_event(uuid, text, boolean, integer, text, boolean, timestamptz) to service_role;
grant execute on function public.refresh_nonresponse_signals(uuid) to service_role;

commit;
