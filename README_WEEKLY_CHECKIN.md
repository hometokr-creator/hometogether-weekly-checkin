# 공동생활 주간 체크인 운영 가이드

## 현재 Production 현황 (2026-08-07 KST)

- 공개 서비스: `https://hometogether-weekly-checkin.vercel.app`
- 관리자 로그인: `https://hometogether-weekly-checkin.vercel.app/admin/login`
- 개인정보 안내: `https://hometogether-weekly-checkin.vercel.app/privacy/checkin`
- Vercel 프로젝트: `hometogether-weekly-checkin`
- 현재 Production Deployment: `dpl_3TcTm1LUkfeZuXB9Pf7enTzLhVYC`
- Supabase 프로젝트: `hometogether-admin` (`qgqnktipmmamzowbxcmg`, Seoul)
- 메시징: `MESSAGING_PROVIDER=mock`; 실제 카카오 알림톡과 SMS는 아직 연결하지 않음
- Production Cron: 일요일 최초 체크인, 월요일 리마인드, 매일 webhook outbox 재처리
- 공식 `checkin.hometogether.kr`은 Cloudflare DNS 권한이 없어 아직 이 Vercel
  프로젝트에 연결하지 않았으며, 위 `vercel.app` 주소가 현재 stable Production URL임
- 인증된 Production Cron 수동 실행은 성공했고 원격 `cron_execution_logs`에도
  기록됐지만 현재 새 `profiles`/`matches`에 실제 활성 매칭이 없어 대상·생성·발송은
  모두 0건이었음. 기존 `app_records`는 구조가 달라 임의로 이관하지 않고 보존함

390×844 모바일 브라우저에서 GREEN/YELLOW/RED 제출, 원격 DB 저장, 관리자
조회, 인증·RLS·토큰 방어를 검증했습니다. 그 뒤 새 Production Deployment를 만들고
같은 응답이 원격 DB와 관리자 화면에 유지되는 것도 확인했습니다. 검증용 응답,
사건, 사용자 데이터는 검증 종료 후 exact ID로 삭제했습니다. 개발 seed는
Production에 적용하지 않았습니다.

검증 당시 생성한 response ID는
`4124321a-0f87-4f07-a88d-19707102204a`,
`15b751dd-1934-49cc-ab82-a9e1fa2d5b74`,
`db17075f-3169-43fb-963a-fcd5cc3a31dc`,
`7aef642e-4a8d-4dc2-84f6-8cc435570325`이고 RED support case ID는
`7cac17ff-e1e5-4250-9e9c-22e43649e2be`입니다. 이 ID들의 재배포 유지와 관리자
노출을 확인한 뒤 관련 테스트 행과 임시 Auth 사용자를 모두 삭제했습니다.

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
- Supabase Postgres migration, transaction RPC, RLS, audit/outbox/rate limit
- Mock/Kakao provider, 선택적 SMS fallback, 메시지 및 webhook 재시도 outbox
- 일요일 18:00 KST 최초 발송, 월요일 18:00 KST 1회 리마인드

상대방에게 응답이나 안전 알림을 자동 전송하는 코드는 없습니다.

## 로컬 실행

Node.js 20 이상과 pnpm을 권장합니다.

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
4. `supabase/seed.sql` (개발 프로젝트에서만)

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
APP_BASE_URL=https://service.example.com
CRON_SECRET=<16자 이상 무작위 값>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_...>
SUPABASE_SECRET_KEY=<sb_secret_...>
CHECKIN_TOKEN_SECRET=<32자 이상 무작위 값>
RATE_LIMIT_HMAC_SECRET=<32자 이상 무작위 값>
MESSAGING_PROVIDER=mock
```

전체 항목은 `.env.example`에 있습니다.

현재 Vercel Production에는 Supabase 공개/서버 키, 앱 URL, token/rate-limit
secret, Cron secret, 관리자 bootstrap secret, webhook signing secret이 등록되어
있습니다. 값은 저장소와 이 문서에 기록하지 않습니다. `ALLOW_DEV_ADMIN=false`,
`ENABLE_SMS_FALLBACK=false`, `MESSAGING_PROVIDER=mock`입니다. 실제 Kakao, SMS,
CRM, 관리자 alert endpoint 자격증명은 등록하지 않았습니다.

## 운영 관리자 최초 생성

관리자 인증·권한 검사는 Production E2E에서 임시 QA 관리자로 검증했고 해당
계정은 정리했습니다. 실제 홈투게더 운영자의 이메일이 제공되지 않았으므로
영구 관리자 계정을 임의로 만들지는 않았습니다. 최초 운영 관리자는 다음 순서로
한 번만 생성합니다.

1. Vercel Production 환경변수 `ADMIN_EMAIL`에 실제 운영자 이메일을 등록합니다.
2. 16자 이상의 임의 값인 `ADMIN_BOOTSTRAP_SECRET`이 등록되어 있는지 확인하고 새
   Production Deployment를 실행합니다.
3. `/admin/bootstrap`에서 `ADMIN_EMAIL`과 같은 이메일, 새 비밀번호,
   `ADMIN_BOOTSTRAP_SECRET`을 입력합니다. 비밀번호는 12자 이상이어야 합니다.
4. 생성된 계정으로 `/admin/login`에 로그인해 응답과 사건을 확인합니다.
5. DB의 일회성 bootstrap state가 재실행을 차단하는지 확인한 뒤 Vercel에서
   `ADMIN_BOOTSTRAP_SECRET`을 제거하고 다시 배포합니다.

관리자 계정은 Supabase Auth와 `admin_memberships`로 관리됩니다. 일반
authenticated 사용자는 서버 권한 검사와 RLS 때문에 관리자 데이터에 접근할 수
없습니다.

## 운영 데이터 확인과 내보내기

- 응답 목록/상세: `/admin/checkins`, `/admin/checkins/{response-id}`
- 긴급 사건 목록/상세: `/admin/support-cases`,
  `/admin/support-cases/{case-id}`
- 최근 Production Cron 성공·실패·대상·발송 건수: `/admin/checkins`의 Cron 섹션
- 기본 관리자 목록과 통계에서는 `is_test=true`를 제외합니다. 승인된 QA 확인
  때만 `/admin/checkins?includeTest=true`를 사용합니다.
- 현재 관리자 UI에는 CSV 다운로드 버튼이 없습니다. 다운로드가 필요하면 권한을
  가진 운영자가 Supabase Dashboard SQL Editor에서 필요한 기간과 열만 제한해
  조회하고 결과의 CSV 다운로드 기능을 사용합니다. 서버 키를 브라우저 스크립트나
  개인 PC의 일반 문서에 복사하지 않습니다.

예시 조회는 민감한 자유서술 원문을 기본 제외합니다.

```sql
select id, invitation_id, risk_level, submitted_at
from public.weekly_checkin_responses
where is_test = false
  and submitted_at >= timestamptz '2026-08-01 00:00:00+09'
order by submitted_at desc;
```

## 토큰과 링크

- 일반 토큰 유틸은 `crypto.randomBytes(32)`를 사용합니다.
- 운영 주간 job은 장애 후 같은 링크를 재구성할 수 있도록 32자 이상의 `CHECKIN_TOKEN_SECRET`과 invitation context로 HMAC-SHA256 256-bit opaque token을 만듭니다.
- DB에는 두 방식 모두 SHA-256 해시만 저장합니다.
- URL에는 participant/match/role/전화번호가 들어가지 않습니다.
- 완료 상태는 만료보다 먼저 판정해 다시 연 링크에서도 안정적인 완료 화면을 보여줍니다.
- 토큰 조회/draft/submit에는 IP 원문 대신 HMAC bucket을 쓰는 Postgres rate limit을 적용합니다.

Vercel Runtime Logs는 실제 request path를 보존할 수 있습니다. `/checkin/{token}` 형식을 유지하는 동안 Log Drain 접근·보존을 최소화하고, Analytics에서 체크인 경로를 제외해야 합니다. 더 엄격한 정책이 필요하면 토큰을 URL fragment로 전달한 뒤 고정 API에서 일회성 HttpOnly session으로 교환하는 방식을 권장합니다.

## Kakao 알림톡 연결

다음을 모두 설정하고 `MESSAGING_PROVIDER=kakao`로 바꿉니다.

```dotenv
KAKAO_API_BASE_URL=
KAKAO_API_KEY=
KAKAO_SENDER_KEY=
KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE=
```

`lib/messaging/kakao-alimtalk-provider.ts`의 `/messages/alimtalk` payload/response mapping만 선택한 중계사 규격에 맞추면 됩니다. 도메인과 job은 `MessagingProvider`에만 의존합니다. 중계사가 idempotency key를 지원하는지 반드시 확인하세요. 지원하지 않으면 “중계사 성공 후 DB 기록 전 장애” 구간의 외부 exactly-once는 완전히 보장할 수 없습니다.

설정이 하나라도 없으면 Mock provider를 사용합니다. Mock은 전화번호를 마스킹하고, 개발 환경에서만 체크인 URL을 콘솔에 표시합니다.

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
- `10 9 * * *`: 실패한 CRM/관리자 webhook outbox 재처리(매일 18:10 KST)

Vercel은 `CRON_SECRET`을 `Authorization: Bearer ...`로 보냅니다. 값이 없거나 일치하지 않으면 모든 cron route가 401로 fail closed합니다.

Vercel Cron은 중복·동시 실행될 수 있어 DB advisory lock, unique constraint, lease, idempotency key를 함께 사용합니다. Vercel은 실패한 cron을 자동 재시도하지 않습니다. 현재 Hobby 제한에 맞춰 각 작업을 하루 최대 1회로 등록했으며, 10분 단위 outbox 재처리가 필요하면 Vercel Pro 이상으로 전환해야 합니다.

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
```

RLS와 transaction RPC는 로컬 Supabase에서 migration을 적용한 뒤 검증해야 합니다. 실제 Kakao/SMS/CRM 전송은 각 중계사 sandbox 자격증명이 있어야 하며, 자격증명이 없는 현재 기본값은 Mock입니다.

## 배포 체크리스트

- Supabase migration 및 운영 관리자 membership 적용
- `ALLOW_DEV_ADMIN=false` 확인, 실제 중계사를 연결한 경우에만
  `MESSAGING_PROVIDER=kakao`로 변경
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
생성 types를 다음 로컬 암호화 대상 폴더에 보존하고 SHA-256 목록을 만들었습니다.

[`../../work/production-backups/2026-08-07-pre-weekly-checkin`](../../work/production-backups/2026-08-07-pre-weekly-checkin)

이 사본은 전체 PostgreSQL dump가 아니며 자동 복구 수단을 대체하지 않습니다.
운영 시작 전 Supabase 유료 backup 또는 정기 `pg_dump`를 별도 보안 저장소로
전송하는 작업을 구성해야 합니다.

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

migration 전 Supabase Dashboard에서 현재 플랜의 자동 백업, 백업 주기,
다운로드 가능 여부와 PITR를 확인합니다. DB 백업은 Storage 객체 자체를 포함하지
않으므로 Storage를 사용한다면 별도 복구 절차가 필요합니다. 검증 보고에는 추정이
아니라 Dashboard에서 확인한 실제 상태를 기록합니다.

코드 롤백은 직전 정상 Vercel Production Deployment를 다시 promote하고,
DB는 additive migration을 원칙으로 합니다. 이미 수집된 응답을 삭제하는 down
migration은 자동 실행하지 않습니다. 스키마 문제가 있으면 서비스 코드를 먼저
호환 버전으로 되돌리고, 승인된 별도 forward migration으로 복구합니다.
