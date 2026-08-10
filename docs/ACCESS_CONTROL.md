# Access control

HomeTogether Weekly Check-in uses Supabase Auth for identity, `admin_memberships`
for authorization, and server-side guards before any service-role data access.
Browser metadata is never used as an authorization source.

## Permission model

| Permission | Intended access | Explicitly excluded |
| --- | --- | --- |
| `CHECKIN_READ` | Aggregated dashboard and minimized, masked response summaries | Raw contact fields, safety cases, raw snapshots, CSV exports |
| `SAFETY_READ` | Safety cases and structured safety answers; combines with `DATA_EXPORT` for raw response/issue CSV | Raw profile phone/email/address and standalone export rights |
| `CONTACT_READ` | Direct profile/home/match rows containing contact or address fields | Data export and mutation rights |
| `DATA_EXPORT` | Audited invitation CSV; combines with `SAFETY_READ` for raw response/issue CSV | Safety-bearing exports by itself; profile/home exports unless also `SUPER_ADMIN` |
| `CASE_WRITE` | Support-case mutations | Membership management and data import |
| `SUPER_ADMIN` | All permissions, membership administration, import, provider test | MFA requirements still apply |

The admin UI masks participant names by default and never returns
`questionSnapshot`. `CHECKIN_READ` also removes free-text issue notes and safety
fields. A raw contact workflow is not currently exposed in the UI. Any future
contact action must call `requireAdmin("CONTACT_READ")`, return only the required
field, and write an audit event.

Direct Data API policies are narrower than the service-role DAL:

- `profiles`, `homes`, and `matches`: self where applicable, otherwise
  `CONTACT_READ`/`SUPER_ADMIN`.
- response and issue rows: AAL2 plus both `DATA_EXPORT` and `SAFETY_READ`, or
  `SUPER_ADMIN`.
- support cases: `SAFETY_READ`/`SUPER_ADMIN`.

CSV routes re-check every dataset-specific permission and AAL2, neutralize
spreadsheet formulas, and record dataset, row count, and filter names in
`audit_logs`. `DATA_EXPORT` alone cannot retrieve raw safety-bearing responses.

## MFA and AAL2 rollout

`/admin/mfa` implements the Supabase TOTP enrollment, challenge, and verify
flow. The QR code remains in the authenticated browser and is never logged or
persisted by the application.

Sensitive operations use the AAL2 guard:

- administrator membership reads and mutations;
- operational import preview/apply/template;
- CSV exports;
- support-case mutations;
- one-off Alimtalk administrator test.

Rollout is deliberately non-locking:

1. With no verified factor and `ADMIN_MFA_ENFORCEMENT_ENABLED` unset/false, an
   existing administrator can continue working and enroll.
2. As soon as that account has a verified TOTP factor, its sensitive operations
   require an AAL2 session. The server uses both the factor list and Supabase's
   authoritative `nextLevel=aal2` assurance result, so a stale factor array
   cannot bypass step-up.
3. Set `ADMIN_MFA_ENFORCEMENT_ENABLED=true` only after every active
   `SUPER_ADMIN` has enrolled and the recovery drill is complete.

The login session check and `/admin/mfa` accept any active least-privilege
administrator membership. They do not require `CHECKIN_READ`, preventing an
export-only or case-only administrator from being locked out of enrollment.

Do not enable the global gate while only one administrator exists. Current
Production enrollment requires the administrator to scan the QR code and enter
the TOTP personally; automation must not capture or relay it. As of the current
hardening handoff, no Production administrator QR enrollment has been confirmed,
so the global enforcement flag must remain disabled.

## Recovery and emergency access

Supabase TOTP does not provide application-managed recovery codes in this
project. Therefore:

1. Maintain at least two independently controlled active `SUPER_ADMIN` accounts.
2. Each administrator enrolls a separate authenticator and verifies AAL2.
3. If one factor is lost, the other AAL2 `SUPER_ADMIN` and a Supabase project
   owner verify the incident before removing only the lost factor through the
   Supabase Auth administration interface.
4. Never delete the Auth user, force-confirm email, share a password, or disable
   MFA globally as the first response.
5. Record who approved the recovery, the affected user ID, timestamps, and the
   factor-removal result without storing a TOTP secret.

If no independent administrator remains, this is a platform-owner recovery and
must follow Supabase account recovery. It is not automated by this repository.

## Review checklist

- Keep `ALLOW_DEV_ADMIN=false` in Production.
- Keep `ADMIN_BOOTSTRAP_SECRET` absent after bootstrap.
- Review active memberships and permissions at least quarterly (schedule TODO:
  operational owner).
- Deactivate leavers immediately; the last active `SUPER_ADMIN` database guard
  prevents accidental removal.
- Never add secrets, customer CSVs, backups, raw responses, or contact data to
  Git.
