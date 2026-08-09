# Production Readiness Snapshot — 2026-08-09

이 문서는 2026-08-09 기준 Weekly Check-in의 개발자 인계용 상태 요약이다. 비밀값,
실제 고객 정보, 실제 운영 CSV, 데이터베이스 dump는 포함하지 않는다.

## 현재 판정

웹 애플리케이션, 원격 Supabase schema, custom domain, Cron route, 관리자 화면,
운영 import/export 도구, Production E2E 검증 도구는 구현돼 있다. 다만 실제 고객
알림톡은 자격증명과 callback/delivery receipt 계약이 없어 안전하게 비활성 상태다.

Production 운영 시작 전 다음 외부 의존성이 해소돼야 한다.

- 승인된 알림톡 사업자, sender profile, template, API credential, callback/receipt 계약
- 현재 활성 HOST/GUEST/home/`ACTIVE` match와 명시적 알림 수신 동의 데이터
- 영구 `SUPER_ADMIN`
- managed backup/PITR 또는 승인된 복구 정책
- Vercel Pro 수준의 outbox 재처리 주기가 필요한지에 대한 운영 결정

## 코드 구조

| 경로 | 역할 |
|---|---|
| `app/` | Next.js App Router page와 Route Handler |
| `components/checkin/` | 참가자용 모바일 체크인 UI |
| `components/admin/` | 관리자 UI |
| `lib/checkin/` | 질문, validation, risk, token, rate limit, repository |
| `lib/auth/` | 관리자와 Cron 인증·권한 |
| `lib/admin/` | CSV export와 System Status |
| `lib/imports/` | 운영 데이터 정규화, preview, plan, apply |
| `lib/messaging/` | 알림 provider 계약과 mock/알림톡/SMS adapter |
| `lib/jobs/` | weekly, reminder, outbox, housekeeping |
| `lib/webhooks/` | CRM/admin alert webhook outbox |
| `lib/supabase/` | browser, session, service-role client |
| `supabase/migrations/` | 현재 application migration 10개 |
| `scripts/` | backup, import, admin, Production validation CLI |
| `tests/`, `e2e/` | Vitest 및 Playwright 검증 |

## 구현된 주요 기능

- HOST/GUEST별 token 기반 weekly check-in invitation
- 모바일 질문 흐름, draft 저장, 만료/완료/위조 token 처리
- 서버 측 `GREEN`/`YELLOW`/`ORANGE`/`RED` 위험도 계산
- RED 응답의 support case와 관리자 action/audit history
- 관리자 응답·사건 조회, CSV export, 운영 CSV import, account management, System Status
- Supabase RLS, 권한 RPC, rate limit, transaction/idempotency, test-data suppression
- weekly/reminder/message/integration outbox Cron과 execution log
- 알림 발송 retry, lease, recipient eligibility 재검증, kill switch
- 논리 backup/checksum과 Production E2E/preflight/persistence/cleanup 도구

상세 기능 및 명령은 `README_WEEKLY_CHECKIN.md`와 `docs/HANDOVER_CHECKLIST.md`를
우선 참고한다.

## 데이터·보안 모델

- 참여자 token은 DB에 raw 값이 아니라 hash만 저장한다.
- 실제 응답, issue, safety 정보, support case는 관리자 권한과 RLS로 분리한다.
- `is_test` 데이터는 응답·사건까지 DB에서 강제 상속되며, 외부 message/webhook을
  만들지 않도록 억제한다.
- browser code에는 publishable key만 사용하고 server secret/service role key는
  server-only module에서만 읽는다.
- service-role 경로는 공개 token 검증, Cron secret, 관리자 permission 검사를
  보안 경계로 사용한다.
- 외부 URL token은 runtime/proxy/browser log에 남을 수 있으므로 운영 log 보존 정책을
  별도로 확정해야 한다.

## Supabase schema 및 migration

핵심 application table은 profile/home/match, weekly run/invitation/draft/response/issue,
support case/event, message/attempt, integration outbox, signal, audit, rate-limit,
Cron execution, admin bootstrap, import staging으로 구성된다.

현재 migration은 아래 10개다.

1. `202608020001_weekly_checkin_schema.sql`
2. `202608020002_weekly_checkin_security_and_rpcs.sql`
3. `202608070001_production_safety_and_operations.sql`
4. `20260807072605_message_outbox_operational.sql`
5. `20260807072611_operational_data_import.sql`
6. `20260807072621_admin_operations.sql`
7. `20260807072845_index_operational_foreign_keys.sql`
8. `20260809015136_harden_touch_updated_at_search_path.sql`
9. `20260809015353_harden_legacy_app_files_rls.sql`
10. `20260809020242_harden_legacy_member_helpers.sql`

`supabase/seed.sql`은 개발 전용이며 Production에 적용하면 안 된다.

### MISSING

- `supabase/config.toml`이 없다.
- 원격 Supabase migration history에만 존재하는 레거시 migration 3개의 원본이 이
  저장소에 없다.
- 이 저장소만으로 깨끗한 새 Supabase project의 전체 레거시 schema를 재현했다는
  보장은 없다. 원격 schema export와 migration source 복구는 별도 운영 작업이다.

## 메시징과 Cron

`vercel.json`은 Hobby-compatible schedule을 제공한다.

- weekly check-in: 일요일 09:00 UTC
- reminder: 월요일 09:00 UTC
- outbox/housekeeping: 매일 09:10 UTC

`vercel.pro.json`은 outbox를 10분 주기로 바꾼다. Vercel Pro 이상 여부는 운영자가
결정해야 한다.

### MISSING

- 실제 알림톡 callback HTTP route와 delivery receipt 영속화가 미완성이다.
- relay-neutral adapter의 payload/status/idempotency mapping은 선택한 사업자 규격으로
  검증돼야 한다.
- 실제 알림톡 자격증명, sender profile, 승인 template, callback secret이 없다.
- `CHECKIN_SENDING_ENABLED`는 운영 준비가 끝날 때까지 true로 설정하면 안 된다.
- CRM/admin alert endpoint도 운영 credential이 연결되지 않았다.

## 운영 데이터와 관리자

현재 자동 이관 가능한 운영 roster가 없다. 기존 legacy record는 active participant,
valid phone, home, current contract 관계를 안전하게 제공하지 않으므로 임의 변환하면 안
된다.

### MISSING

- 실제 HOST/GUEST/home/현재 `ACTIVE` match 데이터가 없다.
- 명시적 notification consent와 유효한 운영 전화번호가 없다.
- 영구 `SUPER_ADMIN`이 없다.

운영 데이터는 `/admin/import` 또는 `pnpm migrate:checkin-data`의 preview → validation
→ plan SHA 확인 → explicit apply 흐름으로만 적재한다. import 전에는 실제 CSV를 Git에
두지 않는다.

## Backup 및 복구

현재 논리 backup script와 checksum verifier가 있지만 full PostgreSQL dump, Auth secret,
Storage object, managed backup/PITR를 대체하지 않는다.

### MISSING

- managed backup/PITR가 없다.
- verified restore drill과 운영 RPO/RTO가 없다.
- Storage를 사용한다면 DB backup과 별도의 backup/restore 절차가 필요하다.

## 검증 상태

최근 로컬 검증 기준:

- Vitest: 31 files / 150 tests passed
- lint: passed
- typecheck: passed
- Next.js production build: passed
- production dependency audit: no known vulnerabilities

Production E2E는 별도 acknowledgement와 isolated test fixture를 사용한다. 실제
운영 데이터나 실제 알림톡 수신을 검증하는 명령이 아니며, Production에서 실행할 때는
`README_WEEKLY_CHECKIN.md`의 preflight, persistence, cleanup 순서를 따른다.

## 아직 남은 운영 위험

- URL bearer token의 log 노출 위험
- RLS/`SECURITY DEFINER` RPC와 service-role route의 지속적인 권한 감사 필요
- raw answer, issue note, import staging, admin-test recipient 정보의 retention 정책 필요
- 관리자 MFA, break-glass 복구, session revoke 정책 필요
- GitHub Actions CI 없음
- remote-only legacy migration source 복구 필요

## 개발자 다음 단계

1. `docs/HANDOVER_CHECKLIST.md`에 따라 서비스 접근 권한을 안전한 채널로 인계받는다.
2. local `.env.local`을 `.env.example`의 **이름만** 참고해 설정한다. 값을 Git에 쓰지
   않는다.
3. code/schema 변경 전에는 현재 README의 migration order와 remote history 차이를
   확인한다.
4. 실제 provider 계약과 운영 data가 준비되기 전에는 bulk sending을 활성화하지 않는다.
