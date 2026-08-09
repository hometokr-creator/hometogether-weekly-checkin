# Alimtalk integration

The application has a provider-neutral outbox, a signed callback contract, and
a durable delivery-receipt state machine. No provider is connected by this
document, and bulk sending must remain disabled until every activation check
passes.

## Fail-closed configuration

Required variable names (values belong only in Vercel Production):

- `ALIMTALK_PROVIDER`
- `ALIMTALK_API_BASE_URL`
- `ALIMTALK_API_KEY`
- `ALIMTALK_API_SECRET`
- `ALIMTALK_SENDER_PROFILE`
- `ALIMTALK_TEMPLATE_CODE`
- `ALIMTALK_CALLBACK_SECRET` (minimum 16 characters; use a high-entropy value)
- `PUBLIC_CHECKIN_BASE_URL`
- `CHECKIN_SENDING_ENABLED`

Legacy `KAKAO_*` aliases remain for rotation compatibility. New setups should
use `ALIMTALK_*`. `ENABLE_SMS_FALLBACK` remains false; Production SMS needs its
own durable outbox and is not enabled by the current adapter.

`ALIMTALK_PROVIDER` is the canonical lowercase provider key (letters, digits,
underscore, and hyphen only). The identical key is stored on each outbox row,
used for status reconciliation, and placed in the callback path. A callback
registered under a different provider key cannot match a sent message.

The safe operating state is:

```text
CHECKIN_SENDING_ENABLED=false
ENABLE_SMS_FALLBACK=false
MESSAGING_PROVIDER=disabled
```

Do not change these values merely because the callback route exists.

## Provider-neutral callback contract

Public endpoint:

```text
POST /api/webhooks/alimtalk/{ALIMTALK_PROVIDER}
Content-Type: application/json
```

Headers:

```text
X-Alimtalk-Timestamp: Unix timestamp in seconds
X-Alimtalk-Event-Id: provider event identifier (recommended)
X-Alimtalk-Signature: sha256=<hex HMAC>
```

The signature input is the exact UTF-8 byte sequence:

```text
{timestamp}.{raw request body}
```

using HMAC-SHA256 and `ALIMTALK_CALLBACK_SECRET`. The timestamp must be within
five minutes. The JSON body is strict:

```json
{
  "eventId": "provider-unique-event-id",
  "messageId": "provider-message-id",
  "status": "accepted|sent|delivered|failed|unknown",
  "occurredAt": "2026-08-09T09:00:00+09:00",
  "errorCode": "optional-provider-code"
}
```

The adapter must be changed only where a selected BSP's payload/status names
differ. Do not weaken the route signature or replay checks to fit a provider.

## State machine and duplicate safety

The durable delivery state is separate from outbox leasing:

```text
UNKNOWN -> ACCEPTED -> SENT -> DELIVERED
     \          \        \-> FAILED
      \----------\----------> FAILED
```

`DELIVERED` and `FAILED` are terminal and cannot regress. Provider event IDs are
unique per provider, so retries return success without applying the transition
again. `(provider, provider_message_id)` is also unique on message logs,
preventing one provider message from being attached to multiple outbox rows.

Only receipt metadata and SHA-256 of the signed payload are stored. Raw callback
bodies, phone numbers, check-in links, and message text are not persisted in the
receipt table.

The send request carries the outbox idempotency key. A timeout is classified as
unknown; before any retry, the dispatcher calls the provider status lookup with
the provider message ID or idempotency key. `ACCEPTED` and `SENT` do not trigger
a duplicate send. Unmatched early callbacks remain durable and are attached
when the provider message ID reaches the message log.

## Activation checklist

All items are required before any real test:

1. BSP account and contract owner identified.
2. Production API credentials stored as sensitive Vercel variables.
3. Approved Kakao sender profile.
4. Approved template whose variables match the application schema.
5. Public callback URL registered with the provider.
6. Provider configured for the timestamped HMAC contract or adapter mapping
   implemented and fixture-tested.
7. Provider status lookup endpoint and status mapping fixture-tested.
8. Administrator verifies System Status shows callback configured while bulk
   sending remains disabled.
9. A single authorized internal test number is approved, an AAL2
   `SUPER_ADMIN` enqueues one admin test, and callback reaches a terminal state.
10. Bulk activation requires a separate operational decision after monitoring,
    rollback, and suppression checks.

Current external blockers are BSP selection, credentials, approved sender
profile/template, exact provider callback specification, callback registration,
and a user-approved internal test number. Until they exist, actual sends are
zero by design.

`readyForAdminTest` is fail-closed: it also requires the signed callback secret
and route readiness. A direct administrator test is not enabled merely because
send credentials and a template exist. Reuse of a provider event ID is accepted
only when the callback body hash, message ID, and normalized delivery state
match the first receipt; conflicting reuse fails instead of being mislabeled as
an idempotent retry.
