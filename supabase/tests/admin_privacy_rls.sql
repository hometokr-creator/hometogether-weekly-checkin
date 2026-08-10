begin;

select plan(37);

select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.message_delivery_receipts'::regclass
  ),
  true,
  'delivery receipts have RLS enabled'
);
select is(
  has_table_privilege('authenticated', 'public.message_delivery_receipts', 'SELECT'),
  false,
  'authenticated cannot select delivery receipts directly'
);
select is(
  has_table_privilege('service_role', 'public.message_delivery_receipts', 'SELECT'),
  true,
  'service role receives the minimum receipt read grant'
);
select is(
  has_table_privilege('service_role', 'public.message_delivery_receipts', 'INSERT'),
  false,
  'service role writes receipts only through the guarded RPC'
);

-- The development seed user and rows are synthetic. Expand only this local
-- membership inside the rollback-only test transaction.
update public.admin_memberships
set permissions = array[
  'CHECKIN_READ', 'CONTACT_READ', 'DATA_EXPORT', 'SUPER_ADMIN'
]::text[]
where user_id = '00000000-0000-4000-8000-000000000001';

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  status,
  delivery_scope,
  recipient_phone
) values (
  'a1000000-0000-4000-8000-000000000001',
  'fixture',
  'ALIMTALK_TEST',
  '010-****-0000',
  'pgtap-admin-test-message-0001',
  'PENDING',
  'ADMIN_TEST',
  '+821000000000'
);

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  status,
  delivery_scope
) values (
  'a1000000-0000-4000-8000-000000000002',
  'fixture',
  'WEEKLY_CHECKIN',
  '010-****-0000',
  'pgtap-production-message-0001',
  'PENDING',
  'PRODUCTION'
);

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  provider_message_id,
  status,
  delivery_scope
) values (
  'a1000000-0000-4000-8000-000000000003',
  'fixture',
  'WEEKLY_CHECKIN',
  '010-****-0000',
  'pgtap-receipt-message-0001',
  'provider-runtime-0001',
  'SENT',
  'PRODUCTION'
);

create temporary table pgtap_first_receipt on commit drop as
select * from public.apply_message_delivery_receipt(
  'fixture',
  'event-runtime-0001',
  'provider-runtime-0001',
  'DELIVERED',
  clock_timestamp(),
  clock_timestamp(),
  repeat('a', 64),
  null
);

select is(
  (select duplicate from pgtap_first_receipt),
  false,
  'first verified receipt is not a duplicate'
);
select is(
  (select matched from pgtap_first_receipt),
  true,
  'first verified receipt matches its message log'
);
select is(
  (select delivery_status from pgtap_first_receipt),
  'DELIVERED',
  'first verified receipt reaches delivered state'
);
select is(
  (
    select delivery_status
    from public.message_logs
    where id = 'a1000000-0000-4000-8000-000000000003'
  ),
  'DELIVERED',
  'message log stores terminal delivery state'
);
select is(
  (
    select duplicate
    from public.apply_message_delivery_receipt(
      'fixture',
      'event-runtime-0001',
      'provider-runtime-0001',
      'DELIVERED',
      clock_timestamp(),
      clock_timestamp(),
      repeat('a', 64),
      null
    )
  ),
  true,
  'byte-identical provider event retry is idempotent'
);
select throws_ok(
  $conflict$
    select *
    from public.apply_message_delivery_receipt(
      'fixture',
      'event-runtime-0001',
      'provider-runtime-0001',
      'FAILED',
      clock_timestamp(),
      clock_timestamp(),
      repeat('b', 64),
      'CONFLICT'
    )
  $conflict$,
  '23505',
  'message_delivery_event_conflict',
  'conflicting reuse of a provider event ID is rejected'
);
select is(
  (
    select delivery_status
    from public.apply_message_delivery_receipt(
      'fixture',
      'event-runtime-0002',
      'provider-runtime-0001',
      'ACCEPTED',
      clock_timestamp(),
      clock_timestamp(),
      repeat('c', 64),
      null
    )
  ),
  'DELIVERED',
  'terminal delivered state cannot regress'
);

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  provider_message_id,
  status,
  failure_class,
  next_attempt_at,
  delivery_scope
) values (
  'a1000000-0000-4000-8000-000000000005',
  'fixture',
  'WEEKLY_CHECKIN',
  '010-****-0000',
  'pgtap-receipt-message-retryable-0001',
  'provider-runtime-retryable-0001',
  'RETRYABLE',
  'UNKNOWN',
  clock_timestamp() + interval '10 minutes',
  'PRODUCTION'
);
create temporary table pgtap_retryable_acceptance on commit drop as
select * from public.apply_message_delivery_receipt(
  'fixture',
  'event-runtime-retryable-0001',
  'provider-runtime-retryable-0001',
  'ACCEPTED',
  clock_timestamp(),
  clock_timestamp(),
  repeat('e', 64),
  null
);
select is(
  (select status from public.message_logs where id = 'a1000000-0000-4000-8000-000000000005'),
  'SENT',
  'an accepted callback closes a retryable outbox row without another send'
);
select is(
  (select delivery_status from public.message_logs where id = 'a1000000-0000-4000-8000-000000000005'),
  'ACCEPTED',
  'accepted callback state is durable on a formerly retryable row'
);
select is(
  (select next_attempt_at from public.message_logs where id = 'a1000000-0000-4000-8000-000000000005'),
  null::timestamptz,
  'accepted callback clears the retry schedule'
);

create temporary table pgtap_early_acceptance on commit drop as
select *
from public.apply_message_delivery_receipt(
  'fixture',
  'event-runtime-early-accepted-0001',
  'provider-runtime-early-accepted-0001',
  'ACCEPTED',
  clock_timestamp(),
  clock_timestamp(),
  repeat('f', 64),
  null
);
select is(
  (select matched from pgtap_early_acceptance),
  false,
  'an early accepted callback remains durable while unmatched'
);

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  provider_message_id,
  status,
  failure_class,
  next_attempt_at,
  delivery_scope
) values (
  'a1000000-0000-4000-8000-000000000006',
  'fixture',
  'WEEKLY_CHECKIN',
  '010-****-0000',
  'pgtap-receipt-message-early-accepted-0001',
  'provider-runtime-early-accepted-0001',
  'RETRYABLE',
  'UNKNOWN',
  clock_timestamp() + interval '10 minutes',
  'PRODUCTION'
);
select is(
  (select status from public.message_logs where id = 'a1000000-0000-4000-8000-000000000006'),
  'SENT',
  'attaching an early accepted receipt closes the retryable row'
);
select is(
  (select delivery_status from public.message_logs where id = 'a1000000-0000-4000-8000-000000000006'),
  'ACCEPTED',
  'attaching an early receipt preserves its accepted delivery state'
);
select is(
  (
    select count(*)
    from public.claim_message_deliveries(
      'fixture',
      'pgtap-receipt-lease',
      true,
      false,
      50,
      120
    ) claim
    where claim.message_log_id in (
      'a1000000-0000-4000-8000-000000000005'::uuid,
      'a1000000-0000-4000-8000-000000000006'::uuid
    )
  ),
  0::bigint,
  'delivery-accepted rows can never be reclaimed for provider I/O'
);

create temporary table pgtap_early_receipt on commit drop as
select *
from public.apply_message_delivery_receipt(
  'fixture',
  'event-runtime-early-0001',
  'provider-runtime-early-0001',
  'FAILED',
  clock_timestamp(),
  clock_timestamp(),
  repeat('d', 64),
  'PROVIDER_REJECTED'
);
select is(
  (select matched from pgtap_early_receipt),
  false,
  'an early callback remains durable while unmatched'
);

insert into public.message_logs (
  id,
  provider,
  message_type,
  recipient_masked,
  idempotency_key,
  provider_message_id,
  status,
  delivery_scope
) values (
  'a1000000-0000-4000-8000-000000000004',
  'fixture',
  'WEEKLY_CHECKIN',
  '010-****-0000',
  'pgtap-receipt-message-early-0001',
  'provider-runtime-early-0001',
  'SENT',
  'PRODUCTION'
);
select is(
  (
    select delivery_status
    from public.message_logs
    where id = 'a1000000-0000-4000-8000-000000000004'
  ),
  'FAILED',
  'early receipt reconciles when its provider message ID arrives'
);
select is(
  (
    select message_log_id
    from public.message_delivery_receipts
    where provider = 'fixture'
      and provider_event_id = 'event-runtime-early-0001'
  ),
  'a1000000-0000-4000-8000-000000000004'::uuid,
  'early receipt is attached to exactly one message log'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';

select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000099'),
  1::bigint,
  'AAL1 administrator retains self-profile access'
);
select is(
  (select count(*) from public.profiles where id = '11000000-0000-4000-8000-000000000001'),
  0::bigint,
  'AAL1 CONTACT_READ cannot read another profile'
);
select is(
  (select count(*) from public.homes),
  0::bigint,
  'AAL1 CONTACT_READ cannot read homes'
);
select is(
  (select count(*) from public.matches),
  0::bigint,
  'AAL1 CONTACT_READ cannot read matches'
);
select is(
  (select count(*) from public.weekly_checkin_responses),
  0::bigint,
  'AAL1 DATA_EXPORT cannot read responses'
);
select is(
  (select count(*) from public.weekly_checkin_issues),
  0::bigint,
  'AAL1 DATA_EXPORT cannot read issues'
);
select is(
  (select count(*) from public.message_logs where delivery_scope = 'ADMIN_TEST'),
  0::bigint,
  'AAL1 SUPER_ADMIN cannot read raw admin test messages'
);
select ok(
  (select count(*) > 0 from public.message_logs where delivery_scope = 'PRODUCTION'),
  'AAL1 CHECKIN_READ retains masked production message visibility'
);

reset role;
update public.admin_memberships
set permissions = array[
  'CHECKIN_READ', 'CONTACT_READ', 'DATA_EXPORT'
]::text[]
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select is(
  (select count(*) from public.weekly_checkin_responses),
  0::bigint,
  'AAL2 DATA_EXPORT alone cannot read safety-bearing responses'
);
select is(
  (select count(*) from public.weekly_checkin_issues),
  0::bigint,
  'AAL2 DATA_EXPORT alone cannot read safety-bearing issues'
);

reset role;
update public.admin_memberships
set permissions = array[
  'CHECKIN_READ', 'SAFETY_READ', 'CONTACT_READ', 'DATA_EXPORT'
]::text[]
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';

select ok(
  (select count(*) > 0 from public.profiles where profile_type in ('HOST', 'GUEST')),
  'AAL2 CONTACT_READ can read participant profiles'
);
select ok(
  (select count(*) > 0 from public.homes),
  'AAL2 CONTACT_READ can read homes'
);
select ok(
  (select count(*) > 0 from public.matches),
  'AAL2 CONTACT_READ can read matches'
);
select ok(
  (select count(*) > 0 from public.weekly_checkin_responses),
  'AAL2 DATA_EXPORT plus SAFETY_READ can read responses'
);
select ok(
  (select count(*) > 0 from public.weekly_checkin_issues),
  'AAL2 DATA_EXPORT plus SAFETY_READ can read issues'
);

reset role;
update public.admin_memberships
set permissions = array[
  'CHECKIN_READ', 'SAFETY_READ', 'CONTACT_READ', 'DATA_EXPORT', 'SUPER_ADMIN'
]::text[]
where user_id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}';
select is(
  (select count(*) from public.message_logs where delivery_scope = 'ADMIN_TEST'),
  1::bigint,
  'AAL2 SUPER_ADMIN can read the admin test message'
);

reset role;
select * from finish();
rollback;
