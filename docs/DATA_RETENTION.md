# Data retention and privacy operations

This document records implemented behavior. It does not invent a legal
retention period. Product/legal approval for customer-data retention durations
is **MISSING** and must be completed before routine Production operation.

## Data classes

| Class | Examples | Current handling |
| --- | --- | --- |
| Direct identifiers | name, phone, email, address | Stored in `profiles`/`homes`; Git and logs prohibited; dashboard name masked |
| Check-in answers | structured answers, issue free text, safety answers | Stored in response/issue tables; raw snapshot omitted from admin UI |
| Safety operations | case notes, events, assignee | Restricted to `SAFETY_READ`; mutations require `CASE_WRITE` plus AAL2 rollout policy |
| Messaging metadata | masked recipient, provider ID, state, error code | No Production phone snapshot or bearer URL in `message_logs` |
| Delivery receipts | event ID, message ID, canonical state, timestamps, payload hash | Raw callback body and recipient data are not stored |
| Import staging | normalized row JSON and validation issues | Redacted after `purge_after`; default staging window is 24 hours |
| Rate-limit buckets | HMAC-derived bucket keys and counts | Deleted after database expiry |
| Audit trail | administrator ID, action, safe before/after metadata | No secrets, raw contacts, or response bodies |
| Logical backups | application tables and Auth metadata | Git-external, `0700` directory/`0600` files, checksummed |

## Implemented minimization

- `CHECKIN_READ` does not grant direct profile/home/match rows or response table
  export.
- `CONTACT_READ` and `DATA_EXPORT` are separate permissions.
- Default admin dashboards mask display names; `questionSnapshot` is never
  returned. Ordinary readers do not receive safety fields or issue free text.
- CSV exports are permission-checked, AAL2-protected after enrollment, formula
  neutralized, and audited.
- Provider errors are sanitized; check-in bearer tokens and phone numbers are
  redacted from application logs.
- Delivery receipts store a payload checksum rather than the callback body.
- Production customer CSVs, backups, and DB dumps remain outside Git.

## Automated housekeeping

`CHECKIN_OUTBOX` housekeeping invokes only database-approved operations:

- `purge_expired_rate_limits` deletes expired rate-limit buckets.
- `purge_expired_data_import_staging` redacts expired import row payloads while
  retaining a non-PII audit shell.
- Completed check-in submission deletes its draft.

There is currently no automated deletion policy for profiles, homes, matches,
responses, support cases, audit logs, message logs, or delivery receipts.
Running ad-hoc deletion SQL is prohibited.

## Required policy decisions (MISSING)

The privacy/legal owner must approve, for each data class:

1. processing purpose and lawful basis/consent record;
2. Production retention duration and event that starts the clock;
3. litigation/incident hold rules;
4. participant access/correction/deletion procedure and identity verification;
5. minimum audit retention;
6. backup expiry and verified destruction procedure;
7. delivery provider's independent retention and deletion terms.

After approval, implement a new additive migration and a dry-run/reporting job.
It must use exact IDs, preserve referential integrity, write safe audit counts,
exclude legal holds, and be tested against a restored logical backup before
Production use.

## Incident handling

On suspected exposure, disable sending and external integrations, preserve
sanitized correlation IDs, restrict exports, rotate affected credentials, and
follow `docs/INCIDENT_RESPONSE.md`. Do not copy raw rows into tickets, chat,
email, logs, or source control.
