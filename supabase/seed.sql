-- Development-only seed data. Never apply this file to production.
-- Local admin: admin@hometogether.local / hometogether-dev-admin
-- Check-in tokens use the same deterministic development-only HMAC context as
-- lib/checkin/token.ts, so the mock inbox can reconstruct them. Only their
-- SHA-256 hashes are persisted.

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'admin@hometogether.local',
  extensions.crypt('hometogether-dev-admin', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"홈투게더 운영자"}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"admin@hometogether.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = now();

insert into public.profiles (
  id, auth_user_id, profile_type, display_name, phone, is_active
) values
  ('10000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000001', 'ADMIN', '홈투게더 운영자', '+821000000000', true),
  ('11000000-0000-4000-8000-000000000001', null, 'HOST', '김정희', '+821011110001', true),
  ('12000000-0000-4000-8000-000000000001', null, 'GUEST', '박민서', '+821022220001', true),
  ('11000000-0000-4000-8000-000000000002', null, 'HOST', '이영숙', '+821011110002', true),
  ('12000000-0000-4000-8000-000000000002', null, 'GUEST', '최하늘', '+821022220002', true),
  ('11000000-0000-4000-8000-000000000003', null, 'HOST', '윤미자', '+821011110003', true),
  ('12000000-0000-4000-8000-000000000003', null, 'GUEST', '정다온', '+821022220003', true),
  ('11000000-0000-4000-8000-000000000004', null, 'HOST', '한성호', '+821011110004', true),
  ('12000000-0000-4000-8000-000000000004', null, 'GUEST', '강유진', '+821022220004', true),
  ('11000000-0000-4000-8000-000000000005', null, 'HOST', '오순자', '+821011110005', true),
  ('12000000-0000-4000-8000-000000000005', null, 'GUEST', '문지우', '+821022220005', true),
  ('11000000-0000-4000-8000-000000000006', null, 'HOST', '송재호', '+821011110006', true),
  ('12000000-0000-4000-8000-000000000006', null, 'GUEST', '배서윤', '+821022220006', true)
on conflict (id) do update
set auth_user_id = excluded.auth_user_id,
    profile_type = excluded.profile_type,
    display_name = excluded.display_name,
    phone = excluded.phone,
    is_active = excluded.is_active;

insert into public.admin_memberships (user_id, permissions, is_active)
values (
  '00000000-0000-4000-8000-000000000001',
  array['CHECKIN_READ', 'SAFETY_READ', 'CASE_WRITE']::text[],
  true
)
on conflict (user_id) do update
set permissions = excluded.permissions, is_active = excluded.is_active;

insert into public.homes (id, name, city, district, is_active) values
  ('13000000-0000-4000-8000-000000000001', '평온한 집', '서울특별시', '마포구', true),
  ('13000000-0000-4000-8000-000000000002', '햇살 집', '서울특별시', '성북구', true),
  ('13000000-0000-4000-8000-000000000003', '느티나무 집', '서울특별시', '동작구', true),
  ('13000000-0000-4000-8000-000000000004', '푸른 집', '서울특별시', '광진구', true),
  ('13000000-0000-4000-8000-000000000005', '다정한 집', '서울특별시', '서대문구', true),
  ('13000000-0000-4000-8000-000000000006', '한결 집', '서울특별시', '은평구', true)
on conflict (id) do update
set name = excluded.name, city = excluded.city, district = excluded.district, is_active = excluded.is_active;

insert into public.matches (
  id, home_id, host_id, guest_id, status, move_in_date, move_out_date, contract_end_date
) values
  ('14000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'ACTIVE', current_date - 120, null, current_date + 180),
  ('14000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', 'ACTIVE', current_date - 100, null, current_date + 200),
  ('14000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003', 'ACTIVE', current_date - 90, null, current_date + 210),
  ('14000000-0000-4000-8000-000000000004', '13000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000004', 'ACTIVE', current_date - 80, null, current_date + 220),
  ('14000000-0000-4000-8000-000000000005', '13000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000005', 'ACTIVE', current_date - 70, null, current_date + 230),
  ('14000000-0000-4000-8000-000000000006', '13000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000006', '12000000-0000-4000-8000-000000000006', 'ACTIVE', current_date - 60, null, current_date + 240)
on conflict (id) do update
set home_id = excluded.home_id,
    host_id = excluded.host_id,
    guest_id = excluded.guest_id,
    status = excluded.status,
    move_in_date = excluded.move_in_date,
    move_out_date = excluded.move_out_date,
    contract_end_date = excluded.contract_end_date;

with week_anchor as (
  select date_trunc('week', timezone('Asia/Seoul', now()))::date as current_week
), run_rows as (
  select
    '15000000-0000-4000-8000-000000000001'::uuid as id,
    current_week - 14 as week_start,
    'COMPLETED'::text as status
  from week_anchor
  union all
  select '15000000-0000-4000-8000-000000000002', current_week - 7, 'COMPLETED' from week_anchor
  union all
  select '15000000-0000-4000-8000-000000000003', current_week, 'RUNNING' from week_anchor
)
insert into public.weekly_checkin_runs (
  id, week_start, week_end, send_at, reminder_at, expires_at, status, is_test
)
select
  id,
  week_start,
  week_start + 6,
  (week_start::timestamp + interval '6 days 18 hours') at time zone 'Asia/Seoul',
  (week_start::timestamp + interval '7 days 18 hours') at time zone 'Asia/Seoul',
  (week_start::timestamp + interval '10 days') at time zone 'Asia/Seoul',
  status,
  true
from run_rows
on conflict (id) do update
set week_start = excluded.week_start,
    week_end = excluded.week_end,
    send_at = excluded.send_at,
    reminder_at = excluded.reminder_at,
    expires_at = excluded.expires_at,
    status = excluded.status,
    is_test = true;

with invitation_values (
  id, match_id, participant_id, role, status, is_completed
) as (
  values
    ('16000000-0000-4000-8000-000000000001'::uuid, '14000000-0000-4000-8000-000000000001'::uuid, '11000000-0000-4000-8000-000000000001'::uuid, 'HOST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'GUEST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000003', '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'HOST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000004', '14000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', 'GUEST', 'SENT', false),
    ('16000000-0000-4000-8000-000000000005', '14000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000003', 'HOST', 'SENT', false),
    ('16000000-0000-4000-8000-000000000006', '14000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003', 'GUEST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000007', '14000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000004', 'HOST', 'SENT', false),
    ('16000000-0000-4000-8000-000000000008', '14000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000004', 'GUEST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000009', '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005', 'HOST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000010', '14000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000005', 'GUEST', 'COMPLETED', true),
    ('16000000-0000-4000-8000-000000000011', '14000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000006', 'HOST', 'SENT', false),
    ('16000000-0000-4000-8000-000000000012', '14000000-0000-4000-8000-000000000006', '12000000-0000-4000-8000-000000000006', 'GUEST', 'SENT', false)
), current_run as (
  select id, week_start, expires_at, send_at
  from public.weekly_checkin_runs
  where id = '15000000-0000-4000-8000-000000000003'
), tokenized as (
  select
    v.*,
    r.id as run_id,
    r.expires_at,
    r.send_at,
    translate(
      rtrim(
        encode(
          extensions.hmac(
            'weekly:' || r.week_start::text || ':' || v.participant_id::text,
            'development-checkin-token-only',
            'sha256'
          ),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    ) as raw_token
  from invitation_values v cross join current_run r
)
insert into public.weekly_checkin_invitations (
  id, run_id, match_id, participant_id, role, token_hash, status,
  send_attempt_count, sent_at, completed_at, expires_at, created_at
)
select
  v.id,
  v.run_id,
  v.match_id,
  v.participant_id,
  v.role,
  encode(extensions.digest(v.raw_token, 'sha256'), 'hex'),
  v.status,
  1,
  least(now(), v.send_at),
  case when v.is_completed then now() else null end,
  v.expires_at,
  least(now(), v.send_at)
from tokenized v
on conflict (id) do update
set token_hash = excluded.token_hash,
    status = excluded.status,
    sent_at = excluded.sent_at,
    completed_at = excluded.completed_at,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at;

-- Two expired invitations provide the previous two missed weeks for the
-- non-response sample guest.
with old_invitation_values (id, run_id, raw_token) as (
  values
    ('16000000-0000-4000-8000-000000000013'::uuid, '15000000-0000-4000-8000-000000000001'::uuid, 'dev_missed_old_01_0000000000000000000000'),
    ('16000000-0000-4000-8000-000000000014'::uuid, '15000000-0000-4000-8000-000000000002'::uuid, 'dev_missed_old_02_0000000000000000000000')
)
insert into public.weekly_checkin_invitations (
  id, run_id, match_id, participant_id, role, token_hash, status,
  send_attempt_count, sent_at, expires_at, created_at
)
select
  v.id,
  v.run_id,
  '14000000-0000-4000-8000-000000000006',
  '12000000-0000-4000-8000-000000000006',
  'GUEST',
  encode(extensions.digest(v.raw_token, 'sha256'), 'hex'),
  'EXPIRED',
  1,
  r.send_at,
  r.expires_at,
  r.send_at
from old_invitation_values v
join public.weekly_checkin_runs r on r.id = v.run_id
on conflict (id) do update
set token_hash = excluded.token_hash,
    status = excluded.status,
    sent_at = excluded.sent_at,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at;

insert into public.weekly_checkin_responses (
  id, invitation_id, match_id, participant_id, role, questionnaire_version,
  overall_status, issue_status, positive_points, desired_support,
  disclosure_preference, contact_method, contact_window,
  immediate_danger, safe_to_contact, safe_location,
  risk_level, risk_reasons, paired_mismatch, answers_json, question_snapshot, submitted_at
) values
  (
    '17000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000001',
    '14000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'HOST',
    '2026-08-v1', 'VERY_GOOD', 'NO_ISSUE', array['COMMUNICATION_GOOD'], '{}'::text[],
    null, null, null, null, null, null, 'GREEN', '["NO_ISSUE"]', false,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"VERY_GOOD","issueStatus":"NO_ISSUE","positivePoints":["COMMUNICATION_GOOD"],"issues":[],"questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000002', '16000000-0000-4000-8000-000000000002',
    '14000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'GUEST',
    '2026-08-v1', 'GOOD', 'NO_ISSUE', array['PRIVACY_RESPECTED'], '{}'::text[],
    null, null, null, null, null, null, 'GREEN', '["NO_ISSUE"]', false,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"GOOD","issueStatus":"NO_ISSUE","positivePoints":["PRIVACY_RESPECTED"],"issues":[],"questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000003', '16000000-0000-4000-8000-000000000003',
    '14000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'HOST',
    '2026-08-v1', 'SLIGHTLY_UNCOMFORTABLE', 'UNRESOLVED', '{}'::text[], array['COMMUNICATION_GUIDE'],
    'OPS_ONLY', 'KAKAO', 'WEEKDAY_15_18', null, null, null, 'YELLOW', '["SEVERITY_3"]', false,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"SLIGHTLY_UNCOMFORTABLE","issueStatus":"UNRESOLVED","positivePoints":[],"issues":[{"category":"CLEANLINESS","subcategory":"BATHROOM_CLEANING","frequency":"TWO_OR_THREE","severity":3,"discussionStatus":"NOT_DISCLOSED","desiredAction":"COMMUNICATION_GUIDE"}],"disclosurePreference":"OPS_ONLY","contactMethod":"KAKAO","contactWindow":"WEEKDAY_15_18","questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000004', '16000000-0000-4000-8000-000000000006',
    '14000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000003', 'GUEST',
    '2026-08-v1', 'VERY_UNCOMFORTABLE', 'REPEATED', '{}'::text[], array['PHONE_CONSULT'],
    'CONTACT_BEFORE_SHARE', 'PHONE', 'WEEKDAY_18_20', null, null, null, 'ORANGE', '["SEVERITY_4","REPEATED_CARE_PRESSURE"]', false,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"VERY_UNCOMFORTABLE","issueStatus":"REPEATED","positivePoints":[],"issues":[{"category":"CARE_PRESSURE","subcategory":"REPEATED_AFTER_REFUSAL","frequency":"SEVERAL_TIMES","severity":4,"discussionStatus":"DIFFICULT_TO_DISCUSS","desiredAction":"PHONE_CONSULT"}],"disclosurePreference":"CONTACT_BEFORE_SHARE","contactMethod":"PHONE","contactWindow":"WEEKDAY_18_20","questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000005', '16000000-0000-4000-8000-000000000008',
    '14000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000004', 'GUEST',
    '2026-08-v1', 'NEED_HELP_NOW', 'UNRESOLVED', '{}'::text[], array['URGENT_CONTACT'],
    'DO_NOT_SHARE', 'KAKAO', 'NOW', 'IMMEDIATE_DANGER', 'KAKAO_ONLY', 'NO',
    'RED', '["NEED_HELP_NOW","SAFETY_CATEGORY","PHYSICAL_THREAT_OR_VIOLENCE","IMMEDIATE_DANGER"]', false,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"NEED_HELP_NOW","issueStatus":"UNRESOLVED","positivePoints":[],"issues":[{"category":"SAFETY","subcategory":"PHYSICAL_THREAT_VIOLENCE","frequency":"ONCE","severity":5,"discussionStatus":"DIFFICULT_TO_DISCUSS","desiredAction":"URGENT_CONTACT"}],"disclosurePreference":"DO_NOT_SHARE","contactMethod":"KAKAO","contactWindow":"NOW","safety":{"immediateDanger":"IMMEDIATE_DANGER","safeToContact":"KAKAO_ONLY","safeLocation":"NO"},"questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000006', '16000000-0000-4000-8000-000000000009',
    '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005', 'HOST',
    '2026-08-v1', 'VERY_GOOD', 'NO_ISSUE', array['SHARED_SPACE_GOOD'], '{}'::text[],
    null, null, null, null, null, null, 'GREEN', '["NO_ISSUE"]', true,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"VERY_GOOD","issueStatus":"NO_ISSUE","positivePoints":["SHARED_SPACE_GOOD"],"issues":[],"questionSnapshot":{}}', '{}', now()
  ),
  (
    '17000000-0000-4000-8000-000000000007', '16000000-0000-4000-8000-000000000010',
    '14000000-0000-4000-8000-000000000005', '12000000-0000-4000-8000-000000000005', 'GUEST',
    '2026-08-v1', 'VERY_UNCOMFORTABLE', 'WORSENING', '{}'::text[], array['RELOCATION_EXIT_CONSULT'],
    'CONTACT_BEFORE_SHARE', 'PHONE', 'ANY_TIME', null, null, null, 'ORANGE', '["SEVERITY_4","RELOCATION_EXIT_CONSULT_REQUESTED"]', true,
    '{"questionnaireVersion":"2026-08-v1","overallStatus":"VERY_UNCOMFORTABLE","issueStatus":"WORSENING","positivePoints":[],"issues":[{"category":"PRIVACY_BOUNDARY","subcategory":"ROOM_ENTRY_WITHOUT_PERMISSION","frequency":"ALMOST_DAILY","severity":4,"discussionStatus":"WORSENED_AFTER_DISCUSSION","desiredAction":"RELOCATION_EXIT_CONSULT"}],"disclosurePreference":"CONTACT_BEFORE_SHARE","contactMethod":"PHONE","contactWindow":"ANY_TIME","questionSnapshot":{}}', '{}', now()
  )
on conflict (invitation_id) do update
set overall_status = excluded.overall_status,
    issue_status = excluded.issue_status,
    positive_points = excluded.positive_points,
    desired_support = excluded.desired_support,
    disclosure_preference = excluded.disclosure_preference,
    contact_method = excluded.contact_method,
    contact_window = excluded.contact_window,
    immediate_danger = excluded.immediate_danger,
    safe_to_contact = excluded.safe_to_contact,
    safe_location = excluded.safe_location,
    risk_level = excluded.risk_level,
    risk_reasons = excluded.risk_reasons,
    paired_mismatch = excluded.paired_mismatch,
    answers_json = excluded.answers_json,
    question_snapshot = excluded.question_snapshot,
    submitted_at = excluded.submitted_at;

insert into public.weekly_checkin_issues (
  id, response_id, order_index, category, subcategory, frequency, severity,
  discussion_status, desired_action, clarification_preference, additional_note
) values
  ('18000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-000000000003', 0, 'CLEANLINESS', 'BATHROOM_CLEANING', 'TWO_OR_THREE', 3, 'NOT_DISCLOSED', 'COMMUNICATION_GUIDE', null, null),
  ('18000000-0000-4000-8000-000000000002', '17000000-0000-4000-8000-000000000004', 0, 'CARE_PRESSURE', 'REPEATED_AFTER_REFUSAL', 'SEVERAL_TIMES', 4, 'DIFFICULT_TO_DISCUSS', 'PHONE_CONSULT', null, null),
  ('18000000-0000-4000-8000-000000000003', '17000000-0000-4000-8000-000000000005', 0, 'SAFETY', 'PHYSICAL_THREAT_VIOLENCE', 'ONCE', 5, 'DIFFICULT_TO_DISCUSS', 'URGENT_CONTACT', null, null),
  ('18000000-0000-4000-8000-000000000004', '17000000-0000-4000-8000-000000000007', 0, 'PRIVACY_BOUNDARY', 'ROOM_ENTRY_WITHOUT_PERMISSION', 'ALMOST_DAILY', 4, 'WORSENED_AFTER_DISCUSSION', 'RELOCATION_EXIT_CONSULT', null, null)
on conflict (response_id, order_index) do update
set category = excluded.category,
    subcategory = excluded.subcategory,
    frequency = excluded.frequency,
    severity = excluded.severity,
    discussion_status = excluded.discussion_status,
    desired_action = excluded.desired_action,
    clarification_preference = excluded.clarification_preference,
    additional_note = excluded.additional_note;

insert into public.support_cases (
  id, response_id, match_id, participant_id, priority, status
) values (
  '19000000-0000-4000-8000-000000000001',
  '17000000-0000-4000-8000-000000000005',
  '14000000-0000-4000-8000-000000000004',
  '12000000-0000-4000-8000-000000000004',
  'RED',
  'UNACKNOWLEDGED'
)
on conflict (response_id) do update
set priority = excluded.priority, status = 'UNACKNOWLEDGED', acknowledgement_at = null;

insert into public.weekly_checkin_signals (
  id, run_id, match_id, participant_id, invitation_id, signal_type, risk_level, reasons
) values
  (
    '1a000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003',
    '14000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000005',
    '16000000-0000-4000-8000-000000000009', 'PAIRED_MISMATCH', 'YELLOW', '["PAIRED_RISK_MISMATCH"]'
  ),
  (
    '1a000000-0000-4000-8000-000000000002', '15000000-0000-4000-8000-000000000003',
    '14000000-0000-4000-8000-000000000006', '12000000-0000-4000-8000-000000000006',
    '16000000-0000-4000-8000-000000000012', 'TWO_CONSECUTIVE_NON_RESPONSES', 'YELLOW', '["TWO_CONSECUTIVE_NON_RESPONSES"]'
  )
on conflict (run_id, participant_id, signal_type) do update
set risk_level = excluded.risk_level, reasons = excluded.reasons;

insert into public.message_logs (
  id, invitation_id, provider, message_type, recipient_masked, idempotency_key,
  provider_message_id, status, attempt_count, sent_at
)
select
  ('a0000000-0000-4000-8000-' || lpad(row_number() over (order by i.id)::text, 12, '0'))::uuid,
  i.id,
  'mock',
  'WEEKLY_CHECKIN',
  '***-****-' || right(regexp_replace(p.phone, '\D', '', 'g'), 4),
  'weekly:' || i.run_id::text || ':' || i.participant_id::text || ':initial',
  'mock-' || i.id::text,
  'SENT',
  1,
  coalesce(i.sent_at, now())
from public.weekly_checkin_invitations i
join public.profiles p on p.id = i.participant_id
where i.run_id = '15000000-0000-4000-8000-000000000003'
on conflict (idempotency_key) do update
set status = excluded.status,
    provider_message_id = excluded.provider_message_id,
    sent_at = excluded.sent_at;

insert into public.integration_outbox (
  id, event_id, event_type, aggregate_type, aggregate_id, payload,
  dedupe_key, destination, status
) values
  (
    '1b000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001',
    'support_case.created', 'SUPPORT_CASE', '19000000-0000-4000-8000-000000000001',
    '{"caseId":"19000000-0000-4000-8000-000000000001","priority":"RED","status":"UNACKNOWLEDGED"}',
    'support_case.created:19000000-0000-4000-8000-000000000001', 'CRM', 'PENDING'
  ),
  (
    '1b000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000002',
    'admin_alert.critical_case', 'SUPPORT_CASE', '19000000-0000-4000-8000-000000000001',
    '{"caseId":"19000000-0000-4000-8000-000000000001","priority":"RED","status":"UNACKNOWLEDGED"}',
    'admin_alert.critical_case:19000000-0000-4000-8000-000000000001', 'ADMIN_ALERT', 'PENDING'
  )
on conflict (dedupe_key) do update
set payload = excluded.payload, status = excluded.status;

commit;
