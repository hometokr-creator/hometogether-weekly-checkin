begin;

-- Additive operational-data fields. The pre-existing app_records/app_members/
-- app_files tables are intentionally neither read nor altered by this migration.
alter table public.profiles
  alter column phone drop not null,
  add column if not exists email text,
  add column if not exists notification_enabled boolean not null default false,
  add column if not exists source_system text,
  add column if not exists source_record_id text;

alter table public.profiles
  add constraint profiles_email_length_check
    check (email is null or char_length(email) between 3 and 254),
  add constraint profiles_source_pair_check
    check ((source_system is null) = (source_record_id is null)),
  add constraint profiles_source_length_check
    check (
      source_system is null
      or (
        char_length(source_system) between 1 and 80
        and char_length(source_record_id) between 1 and 160
      )
    );

comment on column public.profiles.notification_enabled is
  'Explicit messaging opt-in. Imports must provide this value; false is the fail-closed default.';
comment on column public.profiles.source_record_id is
  'Stable source identifier used for exact, idempotent imports. Never inferred from a name.';

alter table public.homes
  add column if not exists address text,
  add column if not exists host_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists source_system text,
  add column if not exists source_record_id text;

alter table public.homes
  add constraint homes_address_length_check
    check (address is null or char_length(address) <= 500),
  add constraint homes_source_pair_check
    check ((source_system is null) = (source_record_id is null)),
  add constraint homes_source_length_check
    check (
      source_system is null
      or (
        char_length(source_system) between 1 and 80
        and char_length(source_record_id) between 1 and 160
      )
    );

alter table public.matches
  add column if not exists source_system text,
  add column if not exists source_record_id text;

alter table public.matches
  add constraint matches_source_pair_check
    check ((source_system is null) = (source_record_id is null)),
  add constraint matches_source_length_check
    check (
      source_system is null
      or (
        char_length(source_system) between 1 and 80
        and char_length(source_record_id) between 1 and 160
      )
    );

create unique index if not exists profiles_source_record_unique_idx
  on public.profiles(source_system, source_record_id)
  where source_system is not null and source_record_id is not null;
create unique index if not exists homes_source_record_unique_idx
  on public.homes(source_system, source_record_id)
  where source_system is not null and source_record_id is not null;
create unique index if not exists matches_source_record_unique_idx
  on public.matches(source_system, source_record_id)
  where source_system is not null and source_record_id is not null;
create index if not exists profiles_weekly_eligibility_idx
  on public.profiles(profile_type, is_active, notification_enabled)
  where phone is not null;
create index if not exists homes_host_active_idx
  on public.homes(host_profile_id, is_active);

create table public.data_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.admin_memberships(user_id) on delete restrict,
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'APPLYING'
    check (status in ('APPLYING', 'APPLIED', 'FAILED', 'CANCELLED')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  error_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(error_summary) = 'array'),
  applied_at timestamptz,
  purge_after timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'APPLIED') = (applied_at is not null))
);

create unique index data_import_applied_plan_unique_idx
  on public.data_import_batches(file_sha256, plan_sha256)
  where status = 'APPLIED';
create index data_import_batches_created_idx
  on public.data_import_batches(created_at desc);

create table public.data_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.data_import_batches(id) on delete cascade,
  row_number integer not null check (row_number >= 2),
  row_sha256 text not null check (row_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_data jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_data) = 'object'),
  status text not null default 'VALIDATED'
    check (status in ('VALIDATED', 'APPLIED', 'FAILED')),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  host_profile_id uuid references public.profiles(id) on delete set null,
  guest_profile_id uuid references public.profiles(id) on delete set null,
  home_id uuid references public.homes(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  purge_after timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index data_import_rows_purge_idx
  on public.data_import_rows(purge_after)
  where normalized_data <> '{}'::jsonb;

create trigger data_import_batches_set_updated_at
  before update on public.data_import_batches
  for each row execute function public.set_updated_at();

alter table public.data_import_batches enable row level security;
alter table public.data_import_rows enable row level security;

create policy data_import_batches_select_super_admin
  on public.data_import_batches for select to authenticated
  using (public.is_admin('SUPER_ADMIN'));
create policy data_import_rows_select_super_admin
  on public.data_import_rows for select to authenticated
  using (public.is_admin('SUPER_ADMIN'));

revoke all on table public.data_import_batches, public.data_import_rows
  from public, anon, authenticated;
grant select on table public.data_import_batches, public.data_import_rows to authenticated;
grant all on table public.data_import_batches, public.data_import_rows to service_role;

create or replace function public.purge_expired_data_import_staging()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  update public.data_import_rows
  set normalized_data = '{}'::jsonb
  where purge_after <= clock_timestamp()
    and normalized_data <> '{}'::jsonb;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.apply_operational_data_import(
  p_admin_id uuid,
  p_file_name text,
  p_file_sha256 text,
  p_plan_sha256 text,
  p_counts jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_id uuid;
  v_previous_counts jsonb;
  v_row jsonb;
  v_host_id uuid;
  v_guest_id uuid;
  v_home_id uuid;
  v_match_id uuid;
  v_existing_role text;
  v_source_system text;
  v_contract_external_id text;
  v_host_external_id text;
  v_guest_external_id text;
  v_home_external_id text;
  v_status text;
begin
  if not public.admin_has_permission(p_admin_id, 'SUPER_ADMIN') then
    raise exception 'operational_import_forbidden' using errcode = '42501';
  end if;
  if char_length(p_file_name) not between 1 and 255
     or p_file_sha256 !~ '^[0-9a-f]{64}$'
     or p_plan_sha256 !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_counts) <> 'object'
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'invalid_operational_import' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('operational-import:' || p_plan_sha256, 0));

  select batch.id, batch.counts
  into v_batch_id, v_previous_counts
  from public.data_import_batches batch
  where batch.file_sha256 = p_file_sha256
    and batch.plan_sha256 = p_plan_sha256
    and batch.status = 'APPLIED'
  order by batch.created_at desc
  limit 1;

  if v_batch_id is not null then
    return jsonb_build_object(
      'batchId', v_batch_id,
      'alreadyApplied', true,
      'counts', v_previous_counts
    );
  end if;

  insert into public.data_import_batches (
    created_by, file_name, file_sha256, plan_sha256, status, counts
  ) values (
    p_admin_id, p_file_name, p_file_sha256, p_plan_sha256, 'APPLYING', p_counts
  ) returning id into v_batch_id;

  insert into public.data_import_rows (
    batch_id, row_number, row_sha256, normalized_data, status
  )
  select
    v_batch_id,
    (item.value ->> 'rowNumber')::integer,
    encode(extensions.digest(item.value::text, 'sha256'), 'hex'),
    item.value,
    'VALIDATED'
  from jsonb_array_elements(p_rows) item(value);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_system := lower(v_row ->> 'sourceSystem');
    v_contract_external_id := v_row #>> '{contract,externalId}';
    v_home_external_id := v_row #>> '{home,externalId}';
    v_host_external_id := v_row #>> '{host,externalId}';
    v_guest_external_id := v_row #>> '{guest,externalId}';
    v_status := upper(v_row #>> '{contract,status}');

    if char_length(v_source_system) not between 1 and 80
       or char_length(v_contract_external_id) not between 1 and 160
       or char_length(v_home_external_id) not between 1 and 160
       or char_length(v_host_external_id) not between 1 and 160
       or char_length(v_guest_external_id) not between 1 and 160
       or v_host_external_id = v_guest_external_id
       or v_status not in ('PENDING', 'ACTIVE', 'MOVE_OUT_SCHEDULED', 'ENDED', 'CANCELLED')
       or (v_row #>> '{contract,startDate}')::date is null
       or (
         nullif(v_row #>> '{host,phone}', '') is not null
         and (v_row #>> '{host,phone}') !~ '^\+8210[0-9]{8}$'
       )
       or (
         nullif(v_row #>> '{guest,phone}', '') is not null
         and (v_row #>> '{guest,phone}') !~ '^\+8210[0-9]{8}$'
       ) then
      raise exception 'invalid_operational_import_row' using errcode = '22023';
    end if;

    select profile.profile_type into v_existing_role
    from public.profiles profile
    where profile.source_system = v_source_system
      and profile.source_record_id = v_host_external_id;
    if found and v_existing_role <> 'HOST' then
      raise exception 'operational_import_profile_role_conflict' using errcode = '23514';
    end if;

    insert into public.profiles (
      profile_type, display_name, phone, email, is_active,
      notification_enabled, source_system, source_record_id
    ) values (
      'HOST', v_row #>> '{host,name}', nullif(v_row #>> '{host,phone}', ''),
      nullif(lower(v_row #>> '{host,email}'), ''), (v_row #>> '{host,active}')::boolean,
      (v_row #>> '{host,notificationEnabled}')::boolean,
      v_source_system, v_host_external_id
    )
    on conflict (source_system, source_record_id)
      where source_system is not null and source_record_id is not null
    do update set
      display_name = excluded.display_name,
      phone = excluded.phone,
      email = excluded.email,
      is_active = excluded.is_active,
      notification_enabled = excluded.notification_enabled
    returning id into v_host_id;

    select profile.profile_type into v_existing_role
    from public.profiles profile
    where profile.source_system = v_source_system
      and profile.source_record_id = v_guest_external_id;
    if found and v_existing_role <> 'GUEST' then
      raise exception 'operational_import_profile_role_conflict' using errcode = '23514';
    end if;

    insert into public.profiles (
      profile_type, display_name, phone, email, is_active,
      notification_enabled, source_system, source_record_id
    ) values (
      'GUEST', v_row #>> '{guest,name}', nullif(v_row #>> '{guest,phone}', ''),
      nullif(lower(v_row #>> '{guest,email}'), ''), (v_row #>> '{guest,active}')::boolean,
      (v_row #>> '{guest,notificationEnabled}')::boolean,
      v_source_system, v_guest_external_id
    )
    on conflict (source_system, source_record_id)
      where source_system is not null and source_record_id is not null
    do update set
      display_name = excluded.display_name,
      phone = excluded.phone,
      email = excluded.email,
      is_active = excluded.is_active,
      notification_enabled = excluded.notification_enabled
    returning id into v_guest_id;

    insert into public.homes (
      name, address, city, district, is_active, host_profile_id,
      source_system, source_record_id
    ) values (
      v_row #>> '{home,name}', nullif(v_row #>> '{home,address}', ''),
      nullif(v_row #>> '{home,city}', ''), nullif(v_row #>> '{home,district}', ''),
      (v_row #>> '{home,active}')::boolean, v_host_id,
      v_source_system, v_home_external_id
    )
    on conflict (source_system, source_record_id)
      where source_system is not null and source_record_id is not null
    do update set
      name = excluded.name,
      address = excluded.address,
      city = excluded.city,
      district = excluded.district,
      is_active = excluded.is_active,
      host_profile_id = excluded.host_profile_id
    returning id into v_home_id;

    insert into public.matches (
      home_id, host_id, guest_id, status, move_in_date, move_out_date,
      contract_end_date, source_system, source_record_id
    ) values (
      v_home_id, v_host_id, v_guest_id, v_status,
      (v_row #>> '{contract,startDate}')::date, null,
      nullif(v_row #>> '{contract,endDate}', '')::date,
      v_source_system, v_contract_external_id
    )
    on conflict (source_system, source_record_id)
      where source_system is not null and source_record_id is not null
    do update set
      home_id = excluded.home_id,
      host_id = excluded.host_id,
      guest_id = excluded.guest_id,
      status = excluded.status,
      move_in_date = excluded.move_in_date,
      move_out_date = excluded.move_out_date,
      contract_end_date = excluded.contract_end_date
    returning id into v_match_id;

    update public.data_import_rows import_row
    set status = 'APPLIED',
        host_profile_id = v_host_id,
        guest_profile_id = v_guest_id,
        home_id = v_home_id,
        match_id = v_match_id,
        normalized_data = '{}'::jsonb,
        purge_after = clock_timestamp()
    where import_row.batch_id = v_batch_id
      and import_row.row_number = (v_row ->> 'rowNumber')::integer;
  end loop;

  update public.data_import_batches
  set status = 'APPLIED', applied_at = clock_timestamp(), purge_after = clock_timestamp()
  where id = v_batch_id;

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, after_json
  ) values (
    p_admin_id,
    'DATA_IMPORT_BATCH',
    v_batch_id,
    'OPERATIONAL_DATA_IMPORT_APPLIED',
    jsonb_build_object(
      'fileSha256', p_file_sha256,
      'planSha256', p_plan_sha256,
      'counts', p_counts
    )
  );

  return jsonb_build_object(
    'batchId', v_batch_id,
    'alreadyApplied', false,
    'counts', p_counts
  );
end;
$$;

-- Re-check all mutable eligibility fields inside the transaction. Client-side
-- previewing and repository filtering are advisory; this function is authoritative.
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
  candidate_participants as (
    select distinct candidate.participant_id
    from candidate_rows candidate
  ),
  authoritative_match_counts as (
    select
      candidate.participant_id,
      count(match.id)::integer as eligible_match_count
    from candidate_participants candidate
    join public.profiles profile
      on profile.id = candidate.participant_id
     and profile.is_active
     and profile.notification_enabled
     and profile.phone ~ '^\+8210[0-9]{8}$'
    join public.matches match
      on candidate.participant_id in (match.host_id, match.guest_id)
     and match.status = 'ACTIVE'
     and match.move_in_date <= (p_send_at at time zone 'Asia/Seoul')::date
     and (
       match.move_out_date is null
       or match.move_out_date >= (p_send_at at time zone 'Asia/Seoul')::date
     )
     and (
       match.contract_end_date is null
       or match.contract_end_date >= (p_send_at at time zone 'Asia/Seoul')::date
     )
    join public.homes home on home.id = match.home_id and home.is_active
    group by candidate.participant_id
  ),
  eligible_candidates as (
    select distinct
      c.match_id,
      c.participant_id,
      c.role,
      c.token_hash,
      profile.phone
    from candidate_rows c
    join authoritative_match_counts match_count
      on match_count.participant_id = c.participant_id
     and match_count.eligible_match_count = 1
    join public.matches match on match.id = c.match_id
    join public.homes home on home.id = match.home_id and home.is_active
    join public.profiles profile
      on profile.id = c.participant_id
     and profile.is_active
     and profile.notification_enabled
     and profile.phone ~ '^\+8210[0-9]{8}$'
    where match.status = 'ACTIVE'
      and match.move_in_date <= (p_send_at at time zone 'Asia/Seoul')::date
      and (
        match.move_out_date is null
        or match.move_out_date >= (p_send_at at time zone 'Asia/Seoul')::date
      )
      and (
        match.contract_end_date is null
        or match.contract_end_date >= (p_send_at at time zone 'Asia/Seoul')::date
      )
      and (
        (c.role = 'HOST' and c.participant_id = match.host_id)
        or (c.role = 'GUEST' and c.participant_id = match.guest_id)
      )
      and c.token_hash ~ '^[0-9a-f]{64}$'
  ),
  valid_candidates as (
    select candidate.match_id,
           candidate.participant_id,
           candidate.role,
           candidate.token_hash,
           candidate.phone
    from (
      select eligible.*,
             count(*) over (partition by eligible.participant_id) as eligible_match_count
      from eligible_candidates eligible
    ) candidate
    where candidate.eligible_match_count = 1
  ),
  inserted as (
    insert into public.weekly_checkin_invitations (
      run_id, match_id, participant_id, role, token_hash, status, expires_at
    )
    select
      v_run_id, candidate.match_id, candidate.participant_id,
      candidate.role, candidate.token_hash, 'PENDING', v_expires_at
    from valid_candidates candidate
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
      invitation_id, recipient_profile_id,
      provider, message_type, recipient_masked, idempotency_key, status
    )
    select
      invitation.id,
      invitation.participant_id,
      p_provider,
      'WEEKLY_CHECKIN',
      '***-****-' || right(regexp_replace(profile.phone, '\D', '', 'g'), 4),
      'weekly-checkin:' || p_week_start::text || ':' || invitation.participant_id::text
        || ':' || invitation.match_id::text || ':initial',
      'PENDING'
    from inserted invitation
    join public.profiles profile on profile.id = invitation.participant_id
    on conflict (idempotency_key) do nothing
    returning invitation_id
  )
  select
    invitation.run_id,
    invitation.id,
    invitation.match_id,
    invitation.participant_id,
    invitation.role,
    invitation.token_hash
  from inserted invitation
  join queued message on message.invitation_id = invitation.id;
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
      invitation_id, recipient_profile_id,
      provider, message_type, recipient_masked, idempotency_key, status
    )
    select
      invitation.id,
      invitation.participant_id,
      p_provider,
      'WEEKLY_CHECKIN_REMINDER',
      '***-****-' || right(regexp_replace(profile.phone, '\D', '', 'g'), 4),
      'weekly-checkin:' || run.week_start::text || ':' || invitation.participant_id::text
        || ':' || invitation.match_id::text || ':reminder',
      'PENDING'
    from public.weekly_checkin_invitations invitation
    join public.weekly_checkin_runs run on run.id = invitation.run_id
    join public.matches match on match.id = invitation.match_id
    join public.homes home on home.id = match.home_id and home.is_active
    join public.profiles profile
      on profile.id = invitation.participant_id
     and profile.is_active
     and profile.notification_enabled
     and profile.phone ~ '^\+8210[0-9]{8}$'
    left join public.weekly_checkin_responses response
      on response.invitation_id = invitation.id
    where invitation.run_id = p_run_id
      and run.reminder_at is not null
      and run.reminder_at <= clock_timestamp()
      and invitation.expires_at > clock_timestamp()
      and invitation.sent_at is not null
      and invitation.reminder_sent_at is null
      and invitation.completed_at is null
      and response.id is null
      and match.status = 'ACTIVE'
      and match.move_in_date <= (clock_timestamp() at time zone 'Asia/Seoul')::date
      and (
        match.move_out_date is null
        or match.move_out_date >= (clock_timestamp() at time zone 'Asia/Seoul')::date
      )
      and (
        match.contract_end_date is null
        or match.contract_end_date >= (clock_timestamp() at time zone 'Asia/Seoul')::date
      )
      and (
        (invitation.role = 'HOST' and invitation.participant_id = match.host_id)
        or (invitation.role = 'GUEST' and invitation.participant_id = match.guest_id)
      )
      and 1 = (
        select count(*)
        from public.matches current_match
        join public.homes current_home
          on current_home.id = current_match.home_id
         and current_home.is_active
        where invitation.participant_id in (current_match.host_id, current_match.guest_id)
          and current_match.status = 'ACTIVE'
          and current_match.move_in_date <= (clock_timestamp() at time zone 'Asia/Seoul')::date
          and (
            current_match.move_out_date is null
            or current_match.move_out_date >= (clock_timestamp() at time zone 'Asia/Seoul')::date
          )
          and (
            current_match.contract_end_date is null
            or current_match.contract_end_date >= (clock_timestamp() at time zone 'Asia/Seoul')::date
          )
      )
    on conflict (idempotency_key) do nothing
    returning id
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.purge_expired_data_import_staging()
  from public, anon, authenticated;
revoke all on function public.apply_operational_data_import(uuid, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_weekly_checkin_batch(
  date, date, timestamptz, timestamptz, timestamptz, jsonb, text
) from public, anon, authenticated;
revoke all on function public.enqueue_weekly_checkin_reminders(uuid, text)
  from public, anon, authenticated;

grant execute on function public.purge_expired_data_import_staging() to service_role;
grant execute on function public.apply_operational_data_import(uuid, text, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.create_weekly_checkin_batch(
  date, date, timestamptz, timestamptz, timestamptz, jsonb, text
) to service_role;
grant execute on function public.enqueue_weekly_checkin_reminders(uuid, text)
  to service_role;

commit;
