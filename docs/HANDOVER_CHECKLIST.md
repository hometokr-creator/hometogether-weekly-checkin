# HomeTogether Weekly Check-in 개발자 인계 체크리스트

이 문서는 GitHub repository 밖에서 안전하게 전달해야 할 운영 접근 권한과, 새 담당자가
운영을 재개하기 전에 확인할 순서를 정리한다. 비밀값, token, password, 실제 고객 정보,
운영 CSV, database dump는 이 문서에 기록하지 않는다.

## 1. GitHub 외부에서 별도로 전달할 서비스 접근권한

| 서비스 | 필요한 접근 | 현재 상태 |
|---|---|---|
| Vercel | 프로젝트, Production environment, deployment, Cron, domain 관리 권한 | TODO: 실제 담당자/권한 범위 확인 |
| Supabase | project, Auth, Database, SQL Editor, migration history, backup 설정 접근 | TODO: 실제 담당자/권한 범위 확인 |
| Cloudflare | check-in custom domain의 DNS, proxy, TLS, WAF/rate-limit 설정 접근 | TODO: zone 관리자 확인 |
| 알림톡 사업자 | API, sender profile, 승인 template, callback/receipt 문서와 console 접근 | MISSING: 사업자 및 계약 |
| CRM/admin alert | webhook endpoint와 signing secret 전달 채널 | MISSING: endpoint/credential |
| Backup 저장소 | managed backup/PITR 또는 승인된 logical backup 보관/restore 권한 | MISSING: 운영 정책 |

접근권한은 SSO, password manager, 조직의 승인된 secret manager 등 GitHub 밖의 안전한
채널로 전달한다. Chat, README, issue, commit, PR description에는 비밀값을 적지 않는다.

## 2. 필요한 환경변수 이름과 설정 위치

### 설정 위치

- local development: 개발자 개인의 `.env.local`
- Vercel Production/Preview: 해당 환경의 secret/environment store
- Git: `.env.example`에는 변수 **이름만** 유지

### Supabase

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PLAN`, `SUPABASE_BACKUP_STATUS`,
`SUPABASE_PITR_STATUS`

### URL, token, rate limit, privacy

`PUBLIC_CHECKIN_BASE_URL`, `APP_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `CUSTOM_CHECKIN_DOMAIN`,
`CRON_SECRET`, `CHECKIN_TOKEN_SECRET`, `TOKEN_HASH_SECRET`, `RATE_LIMIT_HMAC_SECRET`,
`PRIVACY_CONTACT_EMAIL`

### 알림톡과 SMS

`ALIMTALK_PROVIDER`, `ALIMTALK_API_BASE_URL`, `ALIMTALK_API_KEY`,
`ALIMTALK_API_SECRET`, `ALIMTALK_SENDER_PROFILE`, `ALIMTALK_TEMPLATE_CODE`,
`ALIMTALK_CALLBACK_SECRET`, `CHECKIN_SENDING_ENABLED`, `ENABLE_CHECKIN_REMINDERS`,
`KAKAO_API_BASE_URL`, `KAKAO_API_KEY`, `KAKAO_API_SECRET`, `KAKAO_SENDER_KEY`,
`KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE`, `KAKAO_CALLBACK_SECRET`,
`ENABLE_SMS_FALLBACK`, `SMS_API_BASE_URL`, `SMS_API_KEY`

### 관리자와 webhook

`ADMIN_EMAILS`, `ADMIN_EMAIL`, `ADMIN_BOOTSTRAP_SECRET`, `ALLOW_DEV_ADMIN`,
`CRM_WEBHOOK_URL`, `CRM_WEBHOOK_SIGNING_SECRET`, `ADMIN_ALERT_WEBHOOK_URL`,
`ADMIN_ALERT_WEBHOOK_SIGNING_SECRET`, `VERCEL_PLAN`, `CHECKIN_OUTBOX_SCHEDULE_MODE`

## 3. 비밀값 취급 원칙

- 문서, Git, GitHub issue, PR, browser console, build log에 비밀값을 적지 않는다.
- `NEXT_PUBLIC_` 접두사는 browser bundle에 포함될 수 있으므로 server secret을 넣지 않는다.
- `SUPABASE_SECRET_KEY`와 legacy service-role key는 server-only 환경에서만 사용한다.
- 실제 운영 CSV, DB dump, backup, customer contact 정보는 GitHub에 올리지 않는다.
- log/error message에 token, phone, 주소, raw answer가 남지 않는지 운영 전 샘플 감사한다.

## 4. Vercel, Supabase, Cloudflare, 알림톡 접근 절차

### Vercel

1. 조직의 승인된 계정으로 프로젝트 권한을 받는다.
2. environment variable의 **이름과 적용 환경**만 인계 문서와 대조한다.
3. Production URL, custom domain, Cron schedule, deployment history를 확인한다.
4. secret 값은 dashboard 또는 승인된 secret manager에서만 관리한다.

### Supabase

1. 승인된 조직 계정으로 project 권한을 받는다.
2. Auth, RLS, public schema grants, migration history, backup 상태를 읽기 전용으로 점검한다.
3. `supabase/config.toml`은 현재 **MISSING**이다. local CLI 연결 정보를 임의로 commit하지
   않는다.
4. schema 변경은 별도 승인된 migration workflow로만 수행한다. 이 인계 작업에서
   `db push`, `db reset`, `migration repair`를 실행하면 안 된다.

### Cloudflare

1. custom domain zone 접근 권한의 소유자를 확인한다.
2. DNS, proxy/TLS, WAF/rate-limit, direct origin alias 정책을 운영자가 확인한다.
3. Cloudflare token은 Git 또는 `.env.example`에 넣지 않는다.

### 알림톡

1. 사업자와 공식 API/callback 문서를 확정한다.
2. sender profile과 template 승인 상태를 확인한다.
3. adapter payload, status lookup, idempotency, callback signature, delivery receipt 저장을
   실제 사업자 sandbox에서 검증한다.
4. 관리자 단건 test가 수신되고 audit/outbox가 기대대로 기록된 뒤에만 bulk sending
   readiness를 검토한다.

## 5. 영구 `SUPER_ADMIN` 생성 절차

현재 영구 `SUPER_ADMIN`은 **MISSING**이다.

1. 실제 운영자 Supabase Auth 계정을 생성 또는 초대하고 이메일 인증을 완료한다.
2. Vercel Production의 `ADMIN_EMAILS`에 해당 인증 이메일을 안전하게 등록한다.
3. 임시 `ADMIN_BOOTSTRAP_SECRET`을 Production secret store에 등록하고 deployment를
   실행한다.
4. `/admin/bootstrap`에서 동일 운영자 계정으로 one-time bootstrap을 수행한다.
5. `/admin/login` 후 `/admin/system`, `/admin/admins`, `/admin/data`의 권한을 확인한다.
6. singleton bootstrap state가 재실행을 차단하는지 확인한 뒤, 임시 bootstrap secret을
   제거하고 다시 배포한다.

비밀번호를 코드나 script로 임의 생성하지 않는다. 마지막 활성 `SUPER_ADMIN`을
비활성화하지 못하도록 관리자 UI/API의 보호 규칙을 유지한다.

## 6. 실제 운영 데이터 import 절차

현재 실제 HOST/GUEST/home/`ACTIVE` match 데이터는 **MISSING**이다.

1. 원본 roster/contract/consent의 소유자와 적법한 처리 근거를 확인한다.
2. `/admin/import` sample template 또는 승인된 CLI 입력 형식을 사용한다.
3. CSV는 Git 외부의 승인된 보관소에서 취급한다.
4. mapping → preview → validation → duplicate/data-quality 검토 → plan SHA 확인 순으로
   진행한다.
5. 운영자가 명시적으로 승인한 apply만 실행한다.
6. 적용 후 활성 profile/home, 정확히 하나의 현재 `ACTIVE` match, valid phone,
   `notification_enabled` 상태를 확인한다.
7. `CHECKIN_SENDING_ENABLED`는 실제 provider readiness와 대상 preview가 확인되기 전
   true로 바꾸지 않는다.

기존 legacy JSON record에서 전화번호, 동의, 계약 관계를 추정해 자동 생성하면 안 된다.

## 7. Backup 및 복구 절차

현재 managed backup/PITR는 **MISSING**이다.

- logical backup: `pnpm backup:logical -- --output <absolute-path>`
- checksum verify: `pnpm backup:verify -- --directory <absolute-path>`

논리 backup은 full PostgreSQL dump, Auth secret, Storage object, managed PITR를 대체하지
않는다. 운영 시작 전 다음을 결정해야 한다.

1. Supabase managed backup/PITR 활성화 여부
2. Storage backup 범위와 보존기간
3. offsite encrypted backup 위치와 접근권한
4. 복구 대상 project, RPO, RTO
5. 실제 restore drill 일정과 성공 기준

장애 복구는 destructive down migration보다 호환 code와 승인된 forward migration을
우선한다.

## 8. 장애 발생 시 확인 순서

1. 사람 안전 또는 개인정보 incident인지 먼저 분류하고 필요한 운영 escalation을 실행한다.
2. 대량 발송/외부 webhook을 중지할 필요가 있는지 승인된 운영자와 판단한다.
3. Vercel deployment/Cron request ID와 runtime error를 확인한다.
4. Supabase Auth, DB, RLS, migration history, outbox/lease 상태를 읽기 전용으로 확인한다.
5. 관리자 `/admin/system`, `/admin/checkins`, `/admin/support-cases`에서 영향 범위를
   확인한다.
6. token, 전화번호, 주소, raw answer, secret을 incident ticket/log에 복사하지 않는다.
7. 복구 후 공개 check-in, 관리자 접근, unauthenticated 차단, Cron 인증을 재검증한다.
8. 재발 방지 변경은 별도 승인된 commit/migration/deployment 절차로 처리한다.

## 9. 아직 미완료인 항목

다음 항목은 현재 **MISSING** 또는 **TODO**다.

- **MISSING:** `supabase/config.toml`
- **MISSING:** 원격에만 있는 레거시 migration 3개 원본
- **MISSING:** 실제 알림톡 callback/delivery receipt 구현 및 검증
- **MISSING:** 실제 HOST/GUEST/home/`ACTIVE` match 운영 데이터
- **MISSING:** 영구 `SUPER_ADMIN`
- **MISSING:** managed backup/PITR
- **MISSING:** GitHub Actions CI
- **MISSING:** 관리자 MFA 및 break-glass/복구 정책
- **TODO:** 알림톡 사업자 계약, credential, sender profile, 승인 template
- **TODO:** CRM/admin alert endpoint와 signing secret
- **TODO:** production log retention과 URL token exposure 정책
- **TODO:** raw answer/import staging/admin-test recipient data retention 정책
- **TODO:** Vercel Hobby와 Pro outbox schedule 중 운영 SLA에 맞는 선택

## 10. 운영 전 최종 점검표

- [ ] Git history와 migration source/remote history 차이를 검토했다.
- [ ] 실제 운영자 `SUPER_ADMIN`을 one-time bootstrap으로 생성하고 로그인했다.
- [ ] 실제 data import를 preview/plan/approval 절차로 완료했다.
- [ ] notification consent, active home/profile/match, valid phone 조건을 확인했다.
- [ ] provider payload/template/callback/delivery receipt를 실제 사업자 환경에서 검증했다.
- [ ] bulk sending을 enable하기 전에 관리자 단건 test 수신을 확인했다.
- [ ] Cron schedule과 execution log를 검증했다.
- [ ] RLS, anonymous access denial, admin permission, token forgery/expiry/IDOR을 점검했다.
- [ ] secret/PII가 Git, deployment log, webhook payload, CSV export에 없는지 감사했다.
- [ ] managed backup/PITR 또는 승인된 backup/restore drill을 완료했다.
- [ ] Vercel/Cloudflare/Supabase/알림톡 담당자와 incident contact path를 확정했다.
- [ ] CI 또는 동등한 release gate를 정의했다.

이 목록 중 MISSING/TODO가 해소되지 않은 상태에서 실제 고객 대량 알림을 시작하지
않는다.
