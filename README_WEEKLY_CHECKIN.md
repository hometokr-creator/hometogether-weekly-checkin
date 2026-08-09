# 공동생활 주간 체크인 운영 가이드

현재 판정: **일부 미완료 — 웹·원격 DB·도메인·Cron·관리자 운영도구·CSV·E2E
배포는 완료했고, 실제 알림톡 자격증명/수신 검증·영구 운영 관리자·실제 계약 데이터·
managed backup/PITR·Vercel Pro 10분 Cron은 외부 설정을 기다리고 있습니다.**

## 현재 Production 현황 (2026-08-09 KST)

- 공개 서비스: `https://checkin.hometogether.kr`
- 관리자 로그인: `https://checkin.hometogether.kr/admin/login`
- 관리자 준비 상태: `https://checkin.hometogether.kr/admin/system`
- 개인정보 안내: `https://checkin.hometogether.kr/privacy/checkin`
- 비상용 Vercel 주소: `https://hometogether-weekly-checkin.vercel.app`
- Vercel 프로젝트: `hometogether-weekly-checkin`
- 현재 Production Deployment: `dpl_SMM1m8HcgU5C6xEozJuY4PeBKtcf` (`Ready`, runtime
  `icn1`). 위 두 alias가 이 배포를 가리키는지 `vercel inspect`로 재확인했습니다.
- Supabase 프로젝트: `hometogether-admin` (`qgqnktipmmamzowbxcmg`, Seoul)
- 도메인: `checkin.hometogether.kr`이 Vercel alias와 Cloudflare를 통해 연결됐고
  HTTPS 200 및 `PUBLIC_CHECKIN_BASE_URL` 일치를 확인함
- 메시징: `MESSAGING_PROVIDER=mock`, `CHECKIN_SENDING_ENABLED=false`, SMS fallback
  비활성. 실제 알림톡 자격증명·발신 프로필·승인 템플릿은 아직 미연결
- Production Cron: 일요일 최초 체크인, 월요일 리마인드, 매일 outbox 재처리.
  3개 route의 인증된 수동 실행과 원격 `cron_execution_logs=COMPLETED`를 확인했으며
  최신 대상·발송·실패는 각각 0건, 누적 완료 12건·실패 0건. 8월 9일 일요일
  정기 작업은 18:00 KST 예정이므로 10:42 KST 감사 시점에는 아직 미실행이 정상
- 요금제: Vercel Hobby, Supabase Free. 따라서 outbox는 현재 일 1회이고 Supabase
  automatic backup/PITR는 비활성
- 영구 운영 관리자: 0명. 기존 Production에서 verified Auth·active app member·legacy
  관리자 세 조건을 모두 만족하는 동일 후보 1명은 확인했지만, `ADMIN_EMAILS` 또는
  운영자의 명시적 승인이 없어 신규 `SUPER_ADMIN` 권한은 임의 부여하지 않음
- 실제 운영 데이터(테스트 제외): profiles 0, hosts 0, guests 0, homes 0,
  active matches 0, 현재 weekly 대상 0

기존 `app_records` 9건은 ads 1, facilities 4, hosts 1, partners 3이며 학생·주거지·
계약 record가 없습니다. 유일한 host에도 운영 가능한 전화번호와 이메일이 없어 새
스키마에 자동 이관할 수 없습니다. 원본은 변경하지 않았고, 실제 데이터는 관리자
CSV Import의 미리보기·중복 검증·명시적 확인을 거쳐서만 반영합니다.

390×844 Production 브라우저 검증은 공개 도메인에서 6/6 통과했습니다. 정상·
위생(YELLOW)·신체적 위협(RED)·동시 중복 제출을 실제 Route Handler로 제출하고,
원격 DB response 4건·issue 1건·RED support case 1건, 관리자 화면 노출,
anonymous/일반 사용자 RLS, 위조·만료·IDOR 차단을 확인했습니다. 테스트 invitation은
`is_test=true`로 격리되어 외부 메시지와 webhook을 만들지 않았습니다. 새 Production
Deployment 뒤 같은 원격 행과 관리자 화면이 유지되는지 재검증한 후 exact ID와
임시 Auth 사용자만 정리합니다. 개발 seed는 Production에 적용하지 않습니다.

실제 이용자 발송 전에는 승인된 운영 데이터 매핑을 통해 활성 집주인·학생·주거지·
계약을 `profiles`, `homes`, `matches`에 적재해야 합니다. 전화번호와 계약 관계를
추정하거나 기존 JSON record를 자동 변환하지 않습니다.

## 구현 범위

- HOST/GUEST별 개인 체크인 invitation과 메시지
- 모바일 우선 한 화면 한 질문, 뒤로 가기, 답변 변경, draft 자동 복구
- 정상·불편·최대 3개 이슈·안전 분기
- 버전이 있는 질문 트리와 제출 시 질문/선택지 snapshot
- 서버 위험도 계산(GREEN/YELLOW/ORANGE/RED), 반복 이슈 승급, paired mismatch
- RED 응답의 `UNACKNOWLEDGED` support case 자동 생성
- 관리자 주간 지표, 응답/사건 상세, 확인·담당·연락·중재·모니터링·종료 액션
- 관리자 운영 CSV Import, 10종 데이터 CSV Export, 관리자 계정 관리, System Status
- Supabase Postgres migration, transaction RPC, RLS, audit/outbox/rate limit
- Mock/알림톡 provider abstraction, 선택적 SMS fallback, 메시지 및 webhook 재시도 outbox
- 5회 retry 상한, 발송 직전 동의·계약·전화번호 재검증, 대량 발송 kill switch
- 논리 백업·checksum 검증 스크립트와 Hobby/Pro Cron 설정 분리
- 일요일 18:00 KST 최초 발송, 월요일 18:00 KST 1회 리마인드

상대방에게 응답이나 안전 알림을 자동 전송하는 코드는 없습니다.

## 로컬 실행

Node.js 22 이상과 저장소에 명시된 pnpm 10.28.0을 사용합니다. Production은 Vercel
Node.js 24.x에서 검증했습니다.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`http://localhost:3000/dev/checkins`에서 여섯 가지 개발 시나리오를 열 수 있습니다. 이 경로와 Mock 원본 링크 출력은 production에서 비활성화됩니다.

Supabase 값이 없으면 로컬 UI/E2E 검증을 위해 프로세스 내 메모리 저장소를 사용합니다. 이 저장소는 개발 전용입니다. `ALLOW_DEV_ADMIN=true`일 때만 로컬 관리자 우회가 켜지며 production에서는 코드상 강제 비활성입니다.

## Supabase 적용

SQL 순서:

1. `supabase/migrations/202608020001_weekly_checkin_schema.sql`
2. `supabase/migrations/202608020002_weekly_checkin_security_and_rpcs.sql`
3. `supabase/migrations/202608070001_production_safety_and_operations.sql`
4. `supabase/migrations/20260807072605_message_outbox_operational.sql`
5. `supabase/migrations/20260807072611_operational_data_import.sql`
6. `supabase/migrations/20260807072621_admin_operations.sql`
7. `supabase/migrations/20260807072845_index_operational_foreign_keys.sql`
8. `supabase/migrations/20260809015136_harden_touch_updated_at_search_path.sql`
9. `supabase/migrations/20260809015353_harden_legacy_app_files_rls.sql`
10. `supabase/migrations/20260809020242_harden_legacy_member_helpers.sql`

`supabase/seed.sql`은 개발 프로젝트에서만 사용하며 Production에는 적용하지 않습니다.
위 10개 HomeTogether migration은 원격 rollback dry-run 뒤 순서대로 적용했습니다.
새 테이블/RPC의 RLS·grant와 외래키 index를 확인했으며 기존 `app_*` 데이터는
삭제하지 않았습니다. 8월 9일 보안 migration은 `touch_updated_at`의 search path와
미래 Data API 기본 권한을 fail closed로 고정하고, 잘못된 `PUBLIC ALL` 정책이 있던
빈 `app_files`의 익명 CRUD 권한과 `app_members`·`app_records`의 익명 grant/권한
확인 RPC를 회수하고, 로그인 구성원의 기존 조회·편집 권한은 유지했습니다. 원격
history에는 이 저장소에 없는
레거시 migration 3개(`20260807052002`, `20260807052931`, `20260807071307`)도 있어
논리 백업 manifest가 이 복구 한계를 명시합니다.

Supabase CLI를 사용하는 경우:

```bash
supabase start
supabase db reset
```

운영에는 새 형식의 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`와 `SUPABASE_SECRET_KEY`를 권장합니다. legacy anon/service role 환경변수도 이전 프로젝트 호환 목적으로만 지원합니다. `SUPABASE_SECRET_KEY`는 RLS를 우회하므로 브라우저 번들에 절대 넣지 않습니다.

주요 원자 작업은 SQL RPC로 처리합니다.

- 주차/run/invitation/message outbox 생성: `create_weekly_checkin_batch`
- 발송 lease claim/완료: `claim_message_deliveries`, `complete_message_delivery`
- draft: `save_weekly_checkin_draft`
- idempotent 제출/response/issues/RED case/outbox: `submit_weekly_checkin`
- 관리자 사건 변경/audit: `admin_update_support_case`
- 분산 rate limit: `consume_checkin_rate_limit`

모든 관련 테이블은 RLS가 활성화됩니다. 일반 사용자는 raw response, issue, safety, support case를 직접 읽을 정책이 없습니다. 관리자도 `CHECKIN_READ`, `SAFETY_READ`, `CASE_WRITE` 권한에 따라 분리됩니다.

## 필수 환경변수

운영 최소값:

```dotenv
PUBLIC_CHECKIN_BASE_URL=https://checkin.hometogether.kr
CRON_SECRET=<16자 이상 무작위 값>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SECRET_KEY=<sb_secret_...>
CHECKIN_TOKEN_SECRET=<32자 이상 무작위 값>
RATE_LIMIT_HMAC_SECRET=<32자 이상 무작위 값>
ALIMTALK_PROVIDER=<공식 사업자 adapter 이름>
ALIMTALK_API_BASE_URL=https://<provider-api>
ALIMTALK_API_KEY=<secret>
ALIMTALK_API_SECRET=<secret>
ALIMTALK_SENDER_PROFILE=<발신 프로필>
ALIMTALK_TEMPLATE_CODE=<승인 템플릿 코드>
ALIMTALK_CALLBACK_SECRET=<16자 이상 secret>
CHECKIN_SENDING_ENABLED=false
```

전체 항목은 `.env.example`에 있습니다.

현재 Vercel Production에는 Supabase 공개/서버 키, 앱 URL, token/rate-limit
secret, Cron secret, 관리자 bootstrap secret, webhook signing secret이 등록되어
있습니다. 값은 저장소와 이 문서에 기록하지 않습니다. `ALLOW_DEV_ADMIN=false`,
`ENABLE_SMS_FALLBACK=false`, `MESSAGING_PROVIDER=mock`입니다. 실제 Kakao, SMS,
CRM, 관리자 alert endpoint 자격증명은 등록하지 않았습니다.

## 운영 관리자 최초 생성

관리자 인증·권한 검사는 Production E2E에서 임시 QA 관리자로 검증했고 해당
계정은 정리했습니다. 기존 Production에는 verified Auth·active app member·legacy
관리자 조건이 모두 일치하는 후보가 정확히 1명 있지만, 이 레거시 권한을 신규
`SUPER_ADMIN` 승인으로 간주할지 확인되지 않았으므로 자동 승격하지 않았습니다.
최초 운영 관리자는 다음 순서로 한 번만 생성합니다.

1. Supabase Auth Dashboard에서 실제 운영자 계정을 초대하거나 생성하고 이메일
   인증을 완료합니다. 임의 비밀번호를 스크립트로 만들지 않습니다.
2. Vercel Production 환경변수 `ADMIN_EMAILS`에 인증된 실제 이메일을 쉼표로
   등록합니다. 형식 오류가 하나라도 있으면 자동 권한 부여는 fail closed합니다.
3. 16자 이상의 임의 값인 `ADMIN_BOOTSTRAP_SECRET`을 새로 설정하고 Production
   Deployment를 실행합니다.
4. `/admin/bootstrap`에서는 같은 이메일과 `ADMIN_BOOTSTRAP_SECRET`만
   입력합니다. 이 화면은 계정이나 비밀번호를 생성·변경하지 않습니다.
5. 생성된 `SUPER_ADMIN`으로 `/admin/login`에 로그인해 `/admin/system`,
   `/admin/admins`, `/admin/data`를 확인합니다.
6. DB의 일회성 bootstrap state가 재실행을 차단하는지 확인한 뒤 Vercel에서
   `ADMIN_BOOTSTRAP_SECRET`을 제거하고 다시 배포합니다.

관리자 계정은 Supabase Auth와 `admin_memberships`로 관리됩니다. 일반
authenticated 사용자는 서버 권한 검사와 RLS 때문에 관리자 데이터에 접근할 수
없습니다. 이후 관리자는 `/admin/admins` 또는 `pnpm admin:manage`로 추가·권한변경·
비활성화·재활성화합니다. 비활성 계정은 `ADMIN_EMAILS`에 남아 있어도 자동으로
재활성화되지 않으며 마지막 활성 `SUPER_ADMIN`은 비활성화할 수 없습니다.

## 운영 데이터 확인과 내보내기

- 응답 목록/상세: `/admin/checkins`, `/admin/checkins/{response-id}`
- 긴급 사건 목록/상세: `/admin/support-cases`,
  `/admin/support-cases/{case-id}`
- 데이터 가져오기: `/admin/import`
- CSV 내보내기: `/admin/data`
- 계정 관리: `/admin/admins`
- DB·대상·알림톡·outbox·Cron·백업·도메인 상태: `/admin/system`
- 기본 관리자 목록과 통계에서는 `is_test=true`를 제외합니다. 승인된 QA 확인
  때만 `/admin/checkins?includeTest=true`를 사용합니다.

CSV Export는 profiles, hosts, guests, homes, active matches, 전체 matches,
weekly check-ins, check-in responses, issues, notification outbox를 지원합니다.
서버가 각 요청에서 권한을 다시 검사하고 범위 pagination을 수행하며, UTF-8 BOM,
모든 cell quoting, Excel formula injection 방어를 적용합니다. dataset·행 수·열거형/
기간 filter만 audit에 남기고 검색 원문이나 전화번호는 audit metadata에 넣지 않습니다.

운영 데이터가 자동 이관 불가능하므로 `/admin/import`의 sample CSV를 사용합니다.
업로드 → 컬럼 매핑 → 미리보기 → 오류/중복 검증 → 명시적 확인 → 단일 transaction
순서이며, `source_system`과 external ID가 같은 행만 멱등 갱신합니다. CLI도 동일한
서버 계획과 plan SHA를 사용합니다.

```bash
pnpm migrate:checkin-data -- --file ./approved-data.csv --dry-run
pnpm migrate:checkin-data -- --file ./approved-data.csv --apply \
  --confirm <reviewed-plan-sha256> --admin-id <super-admin-uuid>
```

CSV 적용 직후에도 `notification_enabled`가 명시적으로 true이고 정확히 하나의 현재
ACTIVE 계약, 활성 home/profile, 유효한 한국 휴대전화번호를 가진 HOST/GUEST만 대상이
됩니다. `CHECKIN_SENDING_ENABLED=false`에서는 주간 invitation과 메시지를 만들지
않습니다.

## 토큰과 링크

- 일반 토큰 유틸은 `crypto.randomBytes(32)`를 사용합니다.
- 운영 주간 job은 장애 후 같은 링크를 재구성할 수 있도록 32자 이상의 `CHECKIN_TOKEN_SECRET`과 invitation context로 HMAC-SHA256 256-bit opaque token을 만듭니다.
- DB에는 두 방식 모두 SHA-256 해시만 저장합니다.
- URL에는 participant/match/role/전화번호가 들어가지 않습니다.
- 완료 상태는 만료보다 먼저 판정해 다시 연 링크에서도 안정적인 완료 화면을 보여줍니다.
- 토큰 조회/draft/submit에는 IP 원문 대신 HMAC bucket을 쓰는 Postgres rate limit을 적용합니다.
- 공개 IP bucket은 토큰 조회보다 먼저 적용해 임의 토큰 회전으로 row가 늘어나지
  않으며, 유효한 invitation에만 별도 token+IP bucket을 만듭니다. Cloudflare custom
  domain은 Vercel이 본 연결 IP가 Cloudflare 공식 CIDR일 때만 `CF-Connecting-IP`를
  신뢰하고, 직접 Vercel alias 요청이나 spoofed header는 Vercel edge IP를 사용합니다.
- draft는 64 KB, 최종 제출은 256 KB로 실제 stream byte를 제한합니다. 선언된 초과
  크기는 DB 접근 전에 413, chunked 초과 크기는 invitation 조회 전에 413으로 종료합니다.

Vercel Runtime Logs는 실제 request path를 보존할 수 있습니다. `/checkin/{token}` 형식을 유지하는 동안 Log Drain 접근·보존을 최소화하고, Analytics에서 체크인 경로를 제외해야 합니다. 더 엄격한 정책이 필요하면 토큰을 URL fragment로 전달한 뒤 고정 API에서 일회성 HttpOnly session으로 교환하는 방식을 권장합니다.

## Kakao 알림톡 연결과 발송 안전장치

공식 알림톡 사업자를 확정한 뒤 다음 값을 Vercel Production secret으로
설정합니다. `KAKAO_*` 기존 이름도 alias로 읽지만 새 운영 환경은
`ALIMTALK_*` 이름을 사용합니다.

```dotenv
ALIMTALK_PROVIDER=
ALIMTALK_API_BASE_URL=
ALIMTALK_API_KEY=
ALIMTALK_API_SECRET=
ALIMTALK_SENDER_PROFILE=
ALIMTALK_TEMPLATE_CODE=
ALIMTALK_CALLBACK_SECRET=
CHECKIN_SENDING_ENABLED=false
```

`lib/messaging/kakao-alimtalk-provider.ts`의 payload, status 조회와 callback 서명
mapping을 선택한 중계사 규격에 맞춰 검증해야 합니다. 도메인과 worker는
`MessagingProvider.sendWeeklyCheckin/getStatus/verifyCallback` 계약에만
의존합니다. 중계사의 idempotency key 지원 여부를 반드시 확인합니다. 현재는
callback 검증 함수만 있고 실제 중계사 callback route와 delivery receipt DB 반영
계약이 없으므로, secret을 채워도 Production 대량 발송 readiness는 false입니다.
공식 중계사 규격으로 이 경로와 영속화를 구현·검증하기 전에는 이 차단을 해제하지
않습니다. 자격증명이 준비된 경우의 관리자 단건 테스트만 별도 허용합니다.

Production은 설정이 하나라도 없으면 Mock으로 내려가지 않고 발송·enqueue를
fail closed합니다. 관리자 `/admin/system`에는 누락된 설정 이름만 표시하고
secret 값은 표시하지 않습니다. `CHECKIN_SENDING_ENABLED`는 정확히 `true`일
때만 주간 invitation과 운영 메시지를 생성하며 기본값은 비활성입니다. 관리자
SUPER_ADMIN의 단건 테스트 outbox는 자격증명·발신 프로필·템플릿이 준비된
경우에만 별도로 사용할 수 있습니다.

SMS fallback은 기본 비활성입니다. 확정 실패에서만 사용되며 timeout처럼 성공 여부를 모르는 경우에는 이중 알림을 피하려고 fallback하지 않습니다.

```dotenv
ENABLE_SMS_FALLBACK=false
SMS_API_BASE_URL=
SMS_API_KEY=
```

SMS도 중계사 선택 전 generic adapter 자리입니다.

## Cron

`vercel.json`:

- `0 9 * * 0`: 일요일 18:00 KST 최초 발송
- `0 9 * * 1`: 월요일 18:00 KST 미완료자 리마인드 1회
- `10 9 * * *`: 알림톡 message outbox와 CRM/관리자 webhook outbox 재처리, 만료된
  rate-limit bucket 삭제와 만료 import staging PII redaction(매일 18:10 KST)

Vercel은 `CRON_SECRET`을 `Authorization: Bearer ...`로 보냅니다. 값이 없거나 일치하지 않으면 모든 cron route가 401로 fail closed합니다.

Vercel Cron은 중복·동시 실행될 수 있어 DB advisory lock, unique constraint, lease, idempotency key를 함께 사용합니다. Vercel은 실패한 cron을 자동 재시도하지 않습니다. 현재 Hobby 제한에 맞춰 각 작업을 하루 최대 1회로 등록했으며, 10분 단위 outbox 재처리가 필요하면 Vercel Pro 이상으로 전환해야 합니다.

2026-08-07 KST에 Production `CRON_SECRET`을 회전하고 새 배포 뒤 세 route를 Vercel
Cron으로 수동 실행했습니다. 원격 기록은 `WEEKLY_CHECKINS`, `CHECKIN_REMINDERS`,
`CHECKIN_OUTBOX` 모두 `COMPLETED`이며 현재 운영 대상이 없어 target/sent/failed는
각각 0/0/0입니다. 이는 실제 수신 또는 알림톡 전송 검증이 아니라 인증·스케줄·
원격 실행기록 검증입니다.

Pro 전환 후 코드 수정 없이 다음 설정 전용 배포를 실행하면
`vercel.pro.json`의 `*/10 * * * *` schedule이 적용됩니다.

```bash
pnpm deploy:production:pro
```

로컬 수동 실행:

```bash
curl -H 'Authorization: Bearer local-development-cron-secret-only' http://localhost:3000/api/cron/weekly-checkins
curl -H 'Authorization: Bearer local-development-cron-secret-only' http://localhost:3000/api/cron/checkin-reminders
curl -H 'Authorization: Bearer local-development-cron-secret-only' http://localhost:3000/api/cron/checkin-outbox
```

## CRM과 관리자 긴급 알림

제출 transaction이 먼저 최소 payload를 `integration_outbox`에 저장합니다. 전화번호, 주소, 민감 안전 답변 원문은 payload에 포함하지 않습니다.

```dotenv
CRM_WEBHOOK_URL=
CRM_WEBHOOK_SIGNING_SECRET=
ADMIN_ALERT_WEBHOOK_URL=
ADMIN_ALERT_WEBHOOK_SIGNING_SECRET=
```

각 요청은 event id, Unix timestamp, `sha256=<HMAC>` 서명을 헤더에 포함합니다. URL이 없으면 이벤트는 DB에만 남습니다. RED 제출 시 관리자 알림 outbox를 즉시 한 번 처리하고, 실패하면 cron이 lease 기반으로 재시도합니다.

## 테스트와 검증

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm audit --prod
```

최종 검증 기준으로 lint, typecheck, 31개 파일/149개 test, integration 10개,
Playwright local 5개, Production 6개, Next.js Production build, 전체 migration
chain과 주요 DB behavior, `pnpm audit --prod`를 통과했습니다. RLS/privileged RPC는
로컬 PGlite와 원격 Supabase 양쪽에서 확인했습니다. 실제 Kakao/SMS/CRM 전송은 각
중계사 자격증명이 있어야 하며, 자격증명이 없으면 Production worker가 발송을
차단합니다.

## 배포 체크리스트

- Supabase migration 및 운영 관리자 membership 적용
- `ALLOW_DEV_ADMIN=false`, `CHECKIN_SENDING_ENABLED=false`에서 대상 preview 확인
- 실제 중계사 자격증명·발신 프로필·승인 템플릿 입력 후 관리자 테스트 1건 수신 확인
- Vercel Pro schedule 적용 뒤에만 `CHECKIN_SENDING_ENABLED=true`로 변경
- 모든 secret을 Vercel server environment에만 설정
- 승인된 알림톡 template의 변수/버튼 URL과 중계사 payload mapping 확인
- 홈투게더의 검증된 긴급 연락처와 법률 검토된 안전 문구 적용(임의 번호는 코드에 넣지 않음)
- Vercel Runtime Logs/Analytics의 토큰 경로 접근·보존 정책 확인
- Log/CRM에 전화번호·주소·토큰·안전 답변 원문이 없는지 샘플 감사
- cron 중복 호출, relay timeout, webhook 429/5xx 복구 훈련
- 실제 운영 보존 기간과 삭제 정책 확정

## Production 검증 — localhost로 대체할 수 없음

아래 검증은 외부 HTTPS Production URL과 원격 Supabase에만 실행됩니다. URL이
`http://`, `localhost`, `127.0.0.1`이면 시작 전에 실패합니다. Production 검증을
통과하지 않은 상태는 배포 완료가 아닙니다.

### 테스트 데이터 격리 계약

운영 migration은 다음 네 테이블에 `is_test boolean not null default false`를
제공해야 합니다.

- `weekly_checkin_runs`
- `weekly_checkin_invitations`
- `weekly_checkin_responses`
- `support_cases`

테스트 invitation 제출 시 response와 support case의 `is_test=true`가 DB
transaction 안에서 강제로 상속되어야 합니다. 클라이언트가 `is_test`를 선택하거나
해제할 수 있으면 안 됩니다. 관리자 통계와 기본 목록은 테스트 행을 제외하고,
`/admin/checkins?includeTest=true`에서만 “테스트 데이터” 표식과 함께 보여야 합니다.

검증 fixture의 profile/home/match는 기존 운영 스키마에 컬럼을 추가하지 않습니다.
대신 실행 ID에서 계산한 UUID, `[TEST:<run-id>]` 이름, IANA/FCC 테스트 용도의
`+1 999-555-01xx` 번호만 사용하고 exact ID 종속관계로 정리합니다. 실제 학교,
주소, 사용자 전화번호는 만들지 않습니다. 개발 seed는 절대로 Production에
적용하지 않습니다.

RED 검증 전에 테스트 outbox가 실제 CRM, 관리자 호출, Kakao/SMS로 전달되지
않도록 Production 구성을 확인해야 합니다. 확인 전에는 안전 시나리오가 fail
closed됩니다.

### 필요한 로컬 검증 환경변수

다음 값은 검증을 실행하는 신뢰된 운영자 셸에만 넣습니다. `SUPABASE_SECRET_KEY`,
테스트 token, 임시 관리자 비밀번호는 출력하거나 VCS에 커밋하지 않습니다.

```dotenv
PRODUCTION_URL=https://<production-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<server-secret-key>
PRODUCTION_VALIDATION_RUN_ID=prod-YYYYMMDD-01
PRODUCTION_VALIDATION_ACK=I_ACKNOWLEDGE_PRODUCTION_TEST_WRITES
PRODUCTION_VALIDATION_RED_SAFE=I_CONFIRMED_TEST_ALERTS_ARE_BLOCKED
```

legacy 프로젝트는 publishable/secret 키 대신
`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`도 사용할 수 있습니다.
서버 키는 Playwright 브라우저 context에 전달되지 않습니다.

임시 상태 파일은
`$TMPDIR/hometogether-production-validation-<run-id>.json`에 mode `0600`으로
저장됩니다. 여기에 일회용 opaque token과 임시 테스트 관리자 비밀번호가 있으므로
공유하거나 복사하지 않습니다. cleanup 성공 시 파일도 삭제됩니다. Production
Playwright는 실패 artifact에 token URL이 남지 않도록 trace, screenshot, video를
비활성화합니다.

### 1. 배포 전·원격 스키마 preflight

```bash
pnpm prod:test:preflight
```

이 명령은 외부 URL 응답과 위 네 테이블의 `is_test` 컬럼을 읽기 전용으로
확인합니다. 키 값 자체는 출력하지 않습니다.

### 2. 원격 fixture 생성과 Production E2E

한 번의 E2E 실행에서 다음을 실제 Production Route Handler와 원격 DB로
검증합니다.

- 390×844 공개 설문에서 정상 응답 제출
- 욕실 위생 불편 response/issue와 서버 계산 YELLOW
- 신체적 위협 RED, `UNACKNOWLEDGED` support case, 상대방 메시지 0건
- 위조 token, invitation UUID를 token처럼 바꾼 IDOR, 만료 token 차단
- 같은 token 동시 제출 시 response 1건
- 클라이언트의 임의 `riskLevel=RED` 무시와 서버 계산 GREEN
- 로그아웃 관리자 페이지/API 차단 및 무인증 Cron 401
- anonymous 키로 invitation/response/issue/case/message/audit 원본 0행
- 공개 HTML/JS bundle에 Supabase 서버 키가 없는지 확인
- 임시 테스트 관리자 로그인 후 테스트 응답과 RED 최상단 표시

재배포 유지 검증을 위해 첫 실행에서는 fixture를 보존합니다.

```bash
export PRODUCTION_VALIDATION_KEEP_DATA=true
pnpm test:e2e:production
pnpm prod:test:verify-db
pnpm prod:test:state
```

`prod:test:state`와 `prod:test:verify-db`는 response/support case ID, 위험도,
건수만 출력하며 token·비밀번호·키는 출력하지 않습니다.

### 3. 새 Production Deployment 뒤 영속성 검증

환경변수를 바꿨다면 먼저 새 Production Deployment를 만들고, Preview가 아닌
Production alias가 새 deployment를 가리키는지 확인합니다. 같은
`PRODUCTION_VALIDATION_RUN_ID`와 운영자 셸 환경을 유지한 채 실행합니다.

```bash
unset PRODUCTION_VALIDATION_KEEP_DATA
pnpm test:e2e:production:persistence
```

이 테스트는 새 데이터를 만들지 않습니다. 이전 response와 support case가 원격
DB에 남아 있는지 다시 읽고, 별도 390px 참가자 context에서 완료 화면을,
새 관리자 browser context에서 실제 응답을 확인합니다. 성공 여부와 관계없이
기본값으로 fixture와 임시 테스트 관리자를 정리합니다.

## 백업과 장애 복구

현재 Supabase 프로젝트는 Free 요금제입니다. Dashboard 확인 시 자동 DB backup은
비활성, 마지막 backup은 없음, 다운로드 가능한 자동 backup도 없음, Point-in-Time
Recovery도 비활성입니다. Supabase Storage object는 DB backup 범위에 포함되지
않으므로 사용 중이라면 별도로 내려받아야 합니다.

Migration 적용 전 기존 `app_records`, `app_members`, `app_files`, 공개 schema와
weekly-checkin 관련 public table, Auth 사용자 metadata, OpenAPI와 생성 types를
다음 권한 제한 폴더에 논리 백업하고 SHA-256 목록을 검증했습니다.

[`../../work/production-backups/2026-08-07-pre-operational-readiness`](../../work/production-backups/2026-08-07-pre-operational-readiness)

운영 보강 뒤 당시 스크립트가 알던 24개 application table, Auth 사용자 수,
저장소 migration 목록을 다시 export해 28개 파일의 checksum을 검증했습니다.
생성 직후 포함돼 있던 만료
rate-limit bucket 60건은 백업 완료 뒤 exact purge RPC로 삭제했고, 활성 bucket이나
운영 데이터는 삭제하지 않았습니다.

[`../../work/production-backups/2026-08-07-post-operational-readiness`](../../work/production-backups/2026-08-07-post-operational-readiness)

최종 재배포·Production E2E·fixture cleanup·Cron 검증 뒤 정리된 상태도 다시
백업했습니다. 이 사본은 rate-limit bucket 0, Cron log 10, application table 24개와
Auth 사용자 1명을 기록하며 28개 파일의 checksum 검증을 통과했습니다. 이후 감사에서
레거시 5개 테이블이 inventory에서 누락됐음을 확인했으므로 이 기존 v1 사본은 완전한
application-data restore가 아닙니다.

[`../../work/production-backups/2026-08-07-final-production-readiness`](../../work/production-backups/2026-08-07-final-production-readiness)

폴더는 mode 0700, 파일은 0600이며 `pnpm backup:verify -- --directory <path>`로 checksum을
다시 확인할 수 있습니다. 현재 v2 `pnpm backup:logical -- --output <new-absolute-path>`는
원격 public application table 29개를 모든 페이지로 읽어 manifest와 checksum을
생성합니다. 다만 `migrations.sql`은 이 저장소 migration만 포함하고 위 레거시 원격 전용
migration 3개는 포함하지 않음을 manifest에 표시합니다. 이 사본은 전체 PostgreSQL SQL dump,
Storage object body, Auth secret을 포함하지 않으므로 native backup/PITR와 복구
훈련을 대체하지 않습니다. 운영 시작 전 Supabase Pro의 Database > Backups에서
자동 backup을 활성화하고, 필요한 RPO에 따라 PITR add-on과 지원 compute를 별도로
활성화해야 합니다.

장애 시에는 다음 순서로 복구합니다.

1. Vercel Cron과 메시징 provider를 중지해 추가 쓰기·발송을 막습니다.
2. 현재 DB를 보존하고 Vercel/Supabase request ID로 장애 범위를 확인합니다.
3. 사용 가능한 최신 managed backup 또는 검증한 `pg_dump`를 새 프로젝트에
   복원합니다. 이번 migration은 additive이므로 테이블을 즉시 삭제하는 down
   migration은 사용하지 않습니다.
4. 복원 프로젝트에서 migration history, RLS, 응답·사건 건수를 검증한 뒤 Vercel
   Production의 Supabase 환경변수를 교체하고 새 Deployment를 만듭니다.
5. 공개 체크인, 관리자 조회, 인증 없는 데이터 접근 차단을 다시 smoke test한 뒤
   Cron을 재개합니다.

배포 직후 DB만 먼저 확인하거나, persistence 테스트에서 cleanup을 보류하려면:

```bash
pnpm prod:test:verify-db
export PRODUCTION_VALIDATION_KEEP_DATA=true
pnpm test:e2e:production:persistence
```

확인이 끝나면 반드시 명시적으로 정리합니다.

```bash
unset PRODUCTION_VALIDATION_KEEP_DATA
pnpm prod:test:cleanup
```

cleanup은 상태 파일에 기록된 exact ID만 대상으로 하며, `is_test=true`가 아닌
run/invitation/response/support case는 삭제하지 않습니다. 임시 관리자도 Auth
`app_metadata.is_test=true`와 같은 validation run 표식을 다시 확인한 뒤에만
삭제합니다. 중간 실패로 상태 파일이 남으면 원인을 수정한 뒤 같은 실행 ID로
cleanup을 다시 실행합니다.

### 4. Production 검증 결과 판정

다음 중 하나라도 확인되지 않으면 “프로덕션 배포 완료”로 보고하지 않습니다.

- HTTPS Production URL과 Production Deployment ID
- 적용 migration 및 원격 네 테이블의 테스트 격리
- 정상/YELLOW/RED/중복 응답의 원격 response ID
- RED support case ID와 관리자 화면 노출
- 비인증 관리자 차단, anonymous RLS, 위조·만료·IDOR 차단
- Production Cron 등록과 무인증 요청 차단
- 새 Production Deployment 후 같은 response ID 유지
- 테스트 데이터 cleanup 또는 의도적인 보존 사유

실제 Kakao 키가 없으면 “웹/원격 DB/Cron/Mock 메시지 검증 완료, 실제 알림톡
발송 미연결”이라고 구분합니다. Mock 상태를 실제 발송 완료로 보고하지 않습니다.

### 장애·백업·롤백 기록

현재 확인값은 Supabase Free, automatic backup `DISABLED`, PITR `DISABLED`이며
`SUPABASE_PLAN`, `SUPABASE_BACKUP_STATUS`, `SUPABASE_PITR_STATUS`로 관리자 System
Status에 명시합니다. 애플리케이션이 Management API key로 이 상태를 추측하지
않습니다. DB backup은 Storage 객체 자체를 포함하지 않으므로 Storage를 사용한다면
별도 복구 절차가 필요합니다.

코드 롤백은 직전 정상 Vercel Production Deployment를 다시 promote하고,
DB는 additive migration을 원칙으로 합니다. 이미 수집된 응답을 삭제하는 down
migration은 자동 실행하지 않습니다. 스키마 문제가 있으면 서비스 코드를 먼저
호환 버전으로 되돌리고, 승인된 별도 forward migration으로 복구합니다.
