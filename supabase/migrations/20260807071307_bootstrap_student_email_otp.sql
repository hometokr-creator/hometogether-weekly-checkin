
do $preflight$
begin
  if to_regclass('public.universities') is not null
    or to_regclass('public.university_email_domains') is not null
    or to_regclass('public.student_email_verifications') is not null
    or to_regprocedure('public.create_student_email_verification(jsonb)') is not null
    or to_regprocedure('public.verify_student_email_otp(uuid,text,text)') is not null
  then
    raise exception 'STUDENT_OTP_BOOTSTRAP_TARGET_ALREADY_EXISTS';
  end if;
end;
$preflight$;

create table if not exists public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint universities_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint universities_normalized_name_length
    check (char_length(btrim(normalized_name)) between 1 and 120),
  constraint universities_normalized_name_canonical
    check (normalized_name = lower(btrim(normalized_name))),
  constraint universities_normalized_name_unique unique (normalized_name)
);

create table if not exists public.university_email_domains (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null
    references public.universities(id) on delete cascade,
  domain text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint university_email_domains_domain_length
    check (char_length(domain) between 4 and 253),
  constraint university_email_domains_domain_canonical
    check (
      domain = lower(btrim(domain))
      and domain !~ '@'
      and domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
    ),
  constraint university_email_domains_domain_unique unique (domain)
);

create table if not exists public.student_email_verifications (
  id uuid primary key,
  university_id uuid references public.universities(id) on delete set null,
  university_name_raw text not null,
  email text not null,
  email_normalized text not null,
  otp_hash text not null,
  status text not null default 'PENDING'
    check (
      status in (
        'PENDING',
        'VERIFIED',
        'INVALIDATED',
        'EXPIRED',
        'LOCKED',
        'CONSUMED'
      )
    ),
  domain_status text not null
    check (domain_status in ('MATCHED', 'PENDING_REVIEW', 'MANUALLY_CONFIRMED')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  resend_available_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  application_id uuid unique,
  request_ip_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_email_verifications_university_name_length
    check (char_length(university_name_raw) <= 120),
  constraint student_email_verifications_email_length
    check (char_length(email) <= 254 and char_length(email_normalized) <= 254),
  constraint student_email_verifications_email_canonical check (
    (status = 'CONSUMED' and application_id is not null)
    or (
      email_normalized = lower(btrim(email_normalized))
      and email_normalized like '%@%'
    )
  ),
  constraint student_email_verifications_otp_hash check (
    (status = 'CONSUMED' and application_id is not null)
    or otp_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint student_email_verifications_ip_hash check (
    (status = 'CONSUMED' and application_id is not null)
    or request_ip_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint student_email_verifications_timing
    check (expires_at > created_at and resend_available_at > created_at),
  constraint student_email_verifications_verified_state check (
    (status in ('VERIFIED', 'CONSUMED') and verified_at is not null)
    or (status not in ('VERIFIED', 'CONSUMED'))
  ),
  constraint student_email_verifications_consumed_state check (
    (status = 'CONSUMED' and consumed_at is not null and application_id is not null)
    or (status <> 'CONSUMED' and consumed_at is null and application_id is null)
  )
);

create function public.create_student_email_verification(
  p_record jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_id uuid;
  v_university_id uuid;
  v_university_name_raw text;
  v_email text;
  v_email_normalized text;
  v_email_domain text;
  v_otp_hash text;
  v_ip_hash text;
  v_domain_status text;
  v_email_count integer;
  v_ip_count integer;
  v_retry_at timestamptz;
  v_email_lock bigint;
  v_ip_lock bigint;
  v_personal_domains constant text[] := array[
    'gmail.com',
    'googlemail.com',
    'naver.com',
    'daum.net',
    'hanmail.net',
    'kakao.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'icloud.com',
    'me.com',
    'yahoo.com',
    'yahoo.co.kr'
  ]::text[];
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'INVALID_VERIFICATION_RECORD' using errcode = '22023';
  end if;

  v_id := nullif(coalesce(p_record ->> 'id', p_record ->> 'verificationId'), '')::uuid;
  if v_id is null then
    raise exception 'VERIFICATION_ID_REQUIRED' using errcode = '22023';
  end if;

  v_university_id := nullif(
    coalesce(p_record ->> 'university_id', p_record ->> 'universityId'),
    ''
  )::uuid;
  v_university_name_raw := btrim(coalesce(
    p_record ->> 'university_name_raw',
    p_record ->> 'universityNameRaw',
    ''
  ));
  v_email := btrim(coalesce(p_record ->> 'email', ''));
  v_email_normalized := lower(v_email);
  v_otp_hash := coalesce(p_record ->> 'otp_hash', p_record ->> 'otpHash', '');
  v_ip_hash := coalesce(
    p_record ->> 'request_ip_hash',
    p_record ->> 'requestIpHash',
    ''
  );

  if char_length(v_university_name_raw) not between 1 and 120 then
    raise exception 'INVALID_UNIVERSITY_NAME' using errcode = '22023';
  end if;
  if char_length(v_email_normalized) not between 3 and 254
    or v_email_normalized not like '%@%'
    or v_email_normalized <> lower(btrim(v_email_normalized)) then
    raise exception 'INVALID_SCHOOL_EMAIL' using errcode = '22023';
  end if;
  if nullif(coalesce(
    p_record ->> 'email_normalized',
    p_record ->> 'emailNormalized'
  ), '') is not null
    and lower(btrim(coalesce(
      p_record ->> 'email_normalized',
      p_record ->> 'emailNormalized'
    ))) <> v_email_normalized then
    raise exception 'EMAIL_NORMALIZATION_MISMATCH' using errcode = '22023';
  end if;
  if v_otp_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_OTP_HASH' using errcode = '22023';
  end if;
  if v_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_IP_HASH' using errcode = '22023';
  end if;

  v_email_domain := split_part(v_email_normalized, '@', 2);
  if v_email_domain = '' or v_email_domain = any(v_personal_domains) then
    raise exception 'PERSONAL_EMAIL_NOT_ALLOWED' using errcode = '22023';
  end if;

  if v_university_id is not null and not exists (
    select 1
    from public.universities u
    where u.id = v_university_id
      and u.active
  ) then
    raise exception 'UNIVERSITY_NOT_FOUND' using errcode = '22023';
  end if;

  if v_university_id is not null and exists (
    select 1
    from public.university_email_domains d
    join public.universities u on u.id = d.university_id
    where d.university_id = v_university_id
      and d.domain = v_email_domain
      and d.active
      and u.active
  ) then
    v_domain_status := 'MATCHED';
  else
    v_domain_status := 'PENDING_REVIEW';
  end if;

  -- Sort advisory-lock IDs to avoid deadlocks while serializing both quotas.
  v_email_lock := hashtextextended(
    'student-email-verification:email:' || v_email_normalized,
    0
  );
  v_ip_lock := hashtextextended(
    'student-email-verification:ip:' || v_ip_hash,
    0
  );
  if v_email_lock <= v_ip_lock then
    perform pg_advisory_xact_lock(v_email_lock);
    if v_ip_lock <> v_email_lock then
      perform pg_advisory_xact_lock(v_ip_lock);
    end if;
  else
    perform pg_advisory_xact_lock(v_ip_lock);
    perform pg_advisory_xact_lock(v_email_lock);
  end if;

  select max(resend_available_at)
  into v_retry_at
  from public.student_email_verifications
  where email_normalized = v_email_normalized
    and created_at >= v_now - interval '1 hour';

  if v_retry_at is not null and v_retry_at > v_now then
    return jsonb_build_object(
      'ok', false,
      'status', 'RESEND_TOO_SOON',
      'retry_at', v_retry_at
    );
  end if;

  select count(*)::integer
  into v_email_count
  from public.student_email_verifications
  where email_normalized = v_email_normalized
    and created_at >= v_now - interval '1 hour';

  if v_email_count >= 5 then
    return jsonb_build_object(
      'ok', false,
      'status', 'RATE_LIMIT_EMAIL',
      'retry_at', v_now + interval '1 hour'
    );
  end if;

  select count(*)::integer
  into v_ip_count
  from public.student_email_verifications
  where request_ip_hash = v_ip_hash
    and created_at >= v_now - interval '1 hour';

  if v_ip_count >= 20 then
    return jsonb_build_object(
      'ok', false,
      'status', 'RATE_LIMIT_IP',
      'retry_at', v_now + interval '1 hour'
    );
  end if;

  -- A fresh request resets prior unconsumed verification state for the same
  -- address. This includes an already-verified row so final submission cannot
  -- reuse stale verification after the user explicitly requests a new code.
  update public.student_email_verifications
  set status = 'INVALIDATED',
      updated_at = v_now
  where email_normalized = v_email_normalized
    and status in ('PENDING', 'VERIFIED')
    and consumed_at is null;

  insert into public.student_email_verifications (
    id,
    university_id,
    university_name_raw,
    email,
    email_normalized,
    otp_hash,
    status,
    domain_status,
    attempt_count,
    expires_at,
    resend_available_at,
    request_ip_hash,
    created_at,
    updated_at
  ) values (
    v_id,
    v_university_id,
    v_university_name_raw,
    v_email_normalized,
    v_email_normalized,
    v_otp_hash,
    'PENDING',
    v_domain_status,
    0,
    v_now + interval '10 minutes',
    v_now + interval '60 seconds',
    v_ip_hash,
    v_now,
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'CREATED',
    'verification_id', v_id,
    'domain_status', v_domain_status,
    'expires_at', v_now + interval '10 minutes',
    'resend_available_at', v_now + interval '60 seconds'
  );
end;
$$;

-- Locks one verification row and compares a server-computed HMAC candidate.
-- A failed email or hash comparison consumes an attempt without revealing
-- which value was incorrect.
create function public.verify_student_email_otp(
  p_id uuid,
  p_email text,
  p_candidate_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_email_normalized text := lower(btrim(coalesce(p_email, '')));
  v_record public.student_email_verifications%rowtype;
  v_attempt_count integer;
begin
  select *
  into v_record
  from public.student_email_verifications
  where id = p_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'NOT_FOUND');
  end if;

  if v_record.status = 'CONSUMED' then
    return jsonb_build_object('ok', false, 'status', 'CONSUMED');
  elsif v_record.status = 'INVALIDATED' then
    return jsonb_build_object('ok', false, 'status', 'INVALIDATED');
  elsif v_record.status = 'EXPIRED' then
    return jsonb_build_object('ok', false, 'status', 'EXPIRED');
  elsif v_record.status = 'LOCKED' or v_record.attempt_count >= 5 then
    if v_record.status <> 'LOCKED' then
      update public.student_email_verifications
      set status = 'LOCKED', updated_at = v_now
      where id = p_id;
    end if;
    return jsonb_build_object(
      'ok', false,
      'status', 'LOCKED',
      'attempts_remaining', 0
    );
  elsif v_record.status = 'VERIFIED' then
    if v_record.email_normalized <> v_email_normalized then
      return jsonb_build_object(
        'ok', false,
        'status', 'EMAIL_MISMATCH',
        'attempts_remaining', 0
      );
    end if;
    return jsonb_build_object(
      'ok', true,
      'status', 'VERIFIED',
      'verification_id', v_record.id,
      'domain_status', v_record.domain_status,
      'verified_at', v_record.verified_at
    );
  end if;

  if v_record.expires_at <= v_now then
    update public.student_email_verifications
    set status = 'EXPIRED', updated_at = v_now
    where id = p_id;
    return jsonb_build_object('ok', false, 'status', 'EXPIRED');
  end if;

  if v_record.email_normalized <> v_email_normalized then
    v_attempt_count := least(v_record.attempt_count + 1, 5);
    update public.student_email_verifications
    set attempt_count = v_attempt_count,
        status = case when v_attempt_count >= 5 then 'LOCKED' else 'PENDING' end,
        updated_at = v_now
    where id = p_id;

    return jsonb_build_object(
      'ok', false,
      'status', case when v_attempt_count >= 5 then 'LOCKED' else 'EMAIL_MISMATCH' end,
      'attempts_remaining', greatest(5 - v_attempt_count, 0)
    );
  end if;

  if coalesce(p_candidate_hash, '') !~ '^[0-9a-f]{64}$'
    or v_record.otp_hash <> p_candidate_hash then
    v_attempt_count := least(v_record.attempt_count + 1, 5);
    update public.student_email_verifications
    set attempt_count = v_attempt_count,
        status = case when v_attempt_count >= 5 then 'LOCKED' else 'PENDING' end,
        updated_at = v_now
    where id = p_id;

    return jsonb_build_object(
      'ok', false,
      'status', case when v_attempt_count >= 5 then 'LOCKED' else 'INVALID_CODE' end,
      'attempts_remaining', greatest(5 - v_attempt_count, 0)
    );
  end if;

  update public.student_email_verifications
  set status = 'VERIFIED',
      verified_at = v_now,
      updated_at = v_now
  where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'VERIFIED',
    'verification_id', p_id,
    'domain_status', v_record.domain_status,
    'verified_at', v_now
  );
end;
$$;

-- Creates the application, CRM case, automatic tags, and first activity log
-- in one database transaction, then consumes the verified email record.
-- Idempotent retries return the original identifiers without making a second
-- application. The function accepts snake_case keys and common camelCase
-- aliases so transport mapping remains explicit but resilient.


create index student_email_verifications_email_created_idx
  on public.student_email_verifications (email_normalized, created_at desc);
create index student_email_verifications_ip_created_idx
  on public.student_email_verifications (request_ip_hash, created_at desc);
create index student_email_verifications_status_expiry_idx
  on public.student_email_verifications (status, expires_at);
create unique index student_email_verifications_one_pending_email_idx
  on public.student_email_verifications (email_normalized)
  where status = 'PENDING';
create index universities_active_name_idx
  on public.universities (active, name);
create index university_email_domains_university_idx
  on public.university_email_domains (university_id, active);

insert into public.universities (name, normalized_name, active)
values
  ('서울과학기술대학교', '서울과학기술대학교', true),
  ('서울시립대학교', '서울시립대학교', true),
  ('한국외국어대학교', '한국외국어대학교', true),
  ('광운대학교', '광운대학교', true),
  ('동덕여자대학교', '동덕여자대학교', true),
  ('한성대학교', '한성대학교', true),
  ('경희대학교', '경희대학교', true)
on conflict do nothing;

insert into public.university_email_domains (university_id, domain, active)
select u.id, seed.domain, true
from (
  values
    ('서울과학기술대학교', 'seoultech.ac.kr'),
    ('서울시립대학교', 'uos.ac.kr'),
    ('한국외국어대학교', 'hufs.ac.kr'),
    ('광운대학교', 'kw.ac.kr'),
    ('동덕여자대학교', 'dongduk.ac.kr'),
    ('한성대학교', 'hansung.ac.kr'),
    ('경희대학교', 'khu.ac.kr')
) as seed(university_name, domain)
join public.universities u
  on u.normalized_name = lower(seed.university_name)
on conflict do nothing;

alter table public.universities enable row level security;
alter table public.university_email_domains enable row level security;
alter table public.student_email_verifications enable row level security;

create policy universities_service_role_only
  on public.universities for all to service_role
  using (true) with check (true);
create policy university_email_domains_service_role_only
  on public.university_email_domains for all to service_role
  using (true) with check (true);
create policy student_email_verifications_service_role_only
  on public.student_email_verifications for all to service_role
  using (true) with check (true);

revoke all on table public.universities from public, anon, authenticated;
revoke all on table public.university_email_domains from public, anon, authenticated;
revoke all on table public.student_email_verifications from public, anon, authenticated;
grant all on table public.universities to service_role;
grant all on table public.university_email_domains to service_role;
grant all on table public.student_email_verifications to service_role;

revoke all on function public.create_student_email_verification(jsonb)
  from public, anon, authenticated;
revoke all on function public.verify_student_email_otp(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_student_email_verification(jsonb)
  to service_role;
grant execute on function public.verify_student_email_otp(uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';
;
