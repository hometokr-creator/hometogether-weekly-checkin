# Production Readiness Snapshot — 2026-08-09

이 문서는 2026-08-09 기준 Weekly Check-in의 개발자 인계용 상태 요약이다. 비밀값,
실제 고객 정보, 실제 운영 CSV, 데이터베이스 dump는 포함하지 않는다.

## 현재 판정

웹 애플리케이션, 원격 Supabase schema, custom domain, Cron route, 관리자 화면,
운영 import/export 도구, Production E2E 검증 도구는 구현돼 있다. 현재 hardening
작업 트리에는 전체 17개 migration source, GitHub Actions, progressive 관리자 MFA,
provider-neutral callback/receipt 구현도 포함돼 있다. 신규 additive migration 2개의
Production 적용, 최종 CI/배포 검증 전에는 이 작업 트리를 배포 완료로 간주하지 않는다.
실제 고객 알림톡은 안전 플래그가 모두 비활성 상태다.

Production 운영 시작 전 다음 외부 의존성이 해소돼야 한다.

- 승인된 알림톡 사업자, sender profile, template, API credential, callback/receipt 계약
- 현재 활성 HOST/GUEST/home/`ACTIVE` match와 명시적 알림 수신 동의 데이터
- managed backup/PITR 또는 승인된 복구 정책
- Vercel Pro 수준의 outbox 재처리 주기가 필요한지에 대한 운영 결정
- 운영 관리자의 직접 TOTP QR 등록과 break-glass 절차

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
| `supabase/migrations/` | 원격 적용 source 15개 + 신규 pending additive migration 2개 |
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
- provider-neutral signed callback, replay 방지, delivery receipt 상태 영속화
- progressive TOTP enrollment UI와 민감 작업 AAL2 guard
- 논리 backup/checksum과 Production E2E/preflight/persistence/cleanup 도구
- 일반 PR CI와 별도 승인형 Production validation GitHub Actions workflow

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

저장소 작업 트리의 전체 migration order는 아래 17개다.

1. `202608020001_weekly_checkin_schema.sql`
2. `202608020002_weekly_checkin_security_and_rpcs.sql`
3. `202608070001_production_safety_and_operations.sql`
4. `20260807052002_hometogether_auth_and_token_access.sql`
5. `20260807052931_hometogether_auth_hardening.sql`
6. `20260807071307_bootstrap_student_email_otp.sql`
7. `20260807072605_message_outbox_operational.sql`
8. `20260807072611_operational_data_import.sql`
9. `20260807072621_admin_operations.sql`
10. `20260807072845_index_operational_foreign_keys.sql`
11. `20260809015136_harden_touch_updated_at_search_path.sql`
12. `20260809015353_harden_legacy_app_files_rls.sql`
13. `20260809020242_harden_legacy_member_helpers.sql`
14. `20260809075546_participant_workflow_hardening.sql`
15. `20260809085834_admin_preset_workflow.sql`
16. `20260809090321_harden_checkin_submission_transaction.sql`
17. `20260809090828_harden_admin_privacy_and_message_receipts.sql`

`supabase/seed.sql`은 개발 전용이며 Production에 적용하면 안 된다.

`supabase/config.toml`은 존재하며 local project ID, PostgreSQL major version,
migration과 development seed replay를 정의한다. hosted project ref나 credential은
포함하지 않는다.

원격에는 1~15가 적용돼 있다. 과거 원격에만 있던 `20260809075546`과
`20260809085834` source는 읽기 전용으로 복구했고 정규화 hash가 원격 source와
일치한다. 16~17은 신규 additive pending migration이다. 따라서 현 시점 상태는 local
source 17, remote applied 15, remote-only 0, local-only 2다. Production 적용 후에는
17/17, DB lint, row-count 불변을 다시 확인해야 한다. migration history 밖에서 생성된
legacy object의 원본 DDL까지 완전 재현한다는 의미는 아니다.

## 메시징과 Cron

`vercel.json`은 Hobby-compatible schedule을 제공한다.

- weekly check-in: 일요일 09:00 UTC
- reminder: 월요일 09:00 UTC
- outbox/housekeeping: 매일 09:10 UTC

`vercel.pro.json`은 outbox를 10분 주기로 바꾼다. Vercel Pro 이상 여부는 운영자가
결정해야 한다.

Provider-neutral callback HTTP route, timestamp-bound HMAC 검증, replay window,
provider event/message ID 기반 idempotent delivery receipt 저장과 상태 전이는
구현돼 있다.

### MISSING

- relay-neutral adapter의 payload/status/idempotency/callback mapping은 선택한 사업자
  규격으로 end-to-end 검증돼야 한다.
- 실제 알림톡 자격증명, sender profile, 승인 template, callback secret이 없다.
- provider console의 callback URL 등록과 실제 delivery receipt 수신 증거가 없다.
- `CHECKIN_SENDING_ENABLED`는 운영 준비가 끝날 때까지 true로 설정하면 안 된다.
- CRM/admin alert endpoint도 운영 credential이 연결되지 않았다.

## 운영 데이터와 관리자

현재 자동 이관 가능한 운영 roster가 없다. 기존 legacy record는 active participant,
valid phone, home, current contract 관계를 안전하게 제공하지 않으므로 임의 변환하면 안
된다.

### MISSING

- 실제 HOST/GUEST/home/현재 `ACTIVE` match 데이터가 없다.
- 명시적 notification consent와 유효한 운영 전화번호가 없다.

Production에는 active 영구 `SUPER_ADMIN` 1명이 있고 one-time bootstrap secret은
제거됐다. TOTP enrollment UI와 민감 작업 AAL2 guard는 구현됐지만, 운영자가 직접
QR을 스캔해 factor 등록을 완료한 상태는 아직 확인되지 않았다. 기존 관리자 잠금을
막기 위해 전역 MFA enforcement는 비활성으로 유지한다.

운영 데이터는 `/admin/import` 또는 `pnpm migrate:checkin-data`의 preview → validation
→ plan SHA 확인 → explicit apply 흐름으로만 적재한다. import 전에는 실제 CSV를 Git에
두지 않는다.

## Backup 및 복구

현재 v3 논리 backup script와 checksum verifier는 동적 Local/Remote migration evidence,
30개 application table inventory와 pending migration table 근거를 검증한다. full
PostgreSQL dump, Auth secret, Storage object, managed backup/PITR를 대체하지 않는다.
기존 기준 백업의 실제 경로와 내용은 Git 문서에 기록하지 않는다.

### MISSING

- managed backup/PITR가 없다.
- rollback-only 격리 drill은 managed schema 26개 table/49개 row와 Auth FK placeholder를
  검증하고 전부 rollback해 **부분 성공**했다. 원본 DDL이 없는 legacy table 3개는 제외돼
  전체 application 복구 증거는 없다.
- 승인된 운영 RPO/RTO가 없다.
- Storage를 사용한다면 DB backup과 별도의 backup/restore 절차가 필요하다.

## 검증 상태

현재 작업 트리는 다음 검증을 모두 다시 통과해야 한다.

- frozen lockfile install, lint, typecheck, unit/coverage/integration test
- Next.js production build와 production dependency audit
- 빈 local Supabase에서 17개 migration과 development seed replay
- local DB lint, repository safety, secret scan
- 일반 PR용 GitHub Actions CI와 승인형 Production validation workflow

과거 test 개수와 배포 결과는 현재 hardening 변경의 최종 증거로 재사용하지 않는다.

Production E2E는 별도 acknowledgement와 isolated test fixture를 사용한다. 실제
운영 데이터나 실제 알림톡 수신을 검증하는 명령이 아니며, Production에서 실행할 때는
`README_WEEKLY_CHECKIN.md`의 preflight, persistence, cleanup 순서를 따른다.

## 아직 남은 운영 위험

- URL bearer token의 log 노출 위험
- RLS/`SECURITY DEFINER` RPC와 service-role route의 지속적인 권한 감사 필요
- raw answer, issue note, import staging, admin-test recipient 정보의 retention 정책 필요
- 운영 관리자 TOTP QR 등록, break-glass 복구, session revoke 정책 필요
- GitHub Actions 정의는 추가됐지만 이번 hardening PR의 실제 green 결과가 필요
- 신규 pending migration 2개의 Production 적용과 Local/Remote 17/17 확인 필요

## 개발자 다음 단계

1. `docs/HANDOVER_CHECKLIST.md`에 따라 서비스 접근 권한을 안전한 채널로 인계받는다.
2. local `.env.local`을 `.env.example`의 **이름만** 참고해 설정한다. 값을 Git에 쓰지
   않는다.
3. code/schema 변경 전에는 현재 README의 migration order와 remote history 차이를
   확인한다.
4. 실제 provider 계약과 운영 data가 준비되기 전에는 bulk sending을 활성화하지 않는다.
