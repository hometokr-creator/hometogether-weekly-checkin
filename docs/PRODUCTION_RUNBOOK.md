# Production Runbook

이 문서는 HomeTogether Weekly Check-in 운영자가 Production 상태를 확인하고, 안전한
배포·점검·중지를 수행하는 절차다. 실제 비밀값, 고객 정보, 원본 응답, 운영 CSV는 이
문서와 Git에 기록하지 않는다.

## 운영 기준

- 공개 주소: `https://checkin.hometogether.kr`
- 비상 주소: `https://hometogether-weekly-checkin.vercel.app`
- Vercel 프로젝트: `hometogether-weekly-checkin`
- Supabase project ref: `qgqnktipmmamzowbxcmg`
- 기본 브랜치: `main`
- 기본 안전 상태:
  - `CHECKIN_SENDING_ENABLED=false`
  - `ENABLE_SMS_FALLBACK=false`
  - `MESSAGING_PROVIDER=disabled`
  - `ALLOW_DEV_ADMIN=false`

실제 알림톡 사업자, 발신 프로필, 승인 템플릿, callback 서명과 delivery receipt가
검증되기 전에는 위 발송 상태를 변경하지 않는다.

## 역할과 접근

- 배포 담당: GitHub `main`, Vercel Production deployment와 environment 접근
- DB 담당: Supabase migration history, SQL/RLS, Auth와 backup 접근
- 안전 운영 담당: `SUPER_ADMIN`과 `SAFETY_READ`/`CASE_WRITE` 권한
- 메시징 담당: 사업자 console, 승인 템플릿, callback/receipt 사양 접근
- DNS 담당: Cloudflare zone, TLS/proxy/WAF 접근

권한 전달은 조직의 password manager 또는 승인된 secret manager를 사용한다. 자세한
권한 구조와 MFA는 `docs/ACCESS_CONTROL.md`를 따른다.

## 매일 상태 확인

1. `/admin/system`에서 DB 연결, 대상 수, outbox, Cron과 메시징 readiness를 확인한다.
2. `cron_execution_logs`의 최신 weekly/reminder/outbox 실행이 `COMPLETED`인지 확인한다.
3. `message_logs`와 `integration_outbox`의 `FAILED`, 만료 lease, due retry 수를 확인한다.
4. `/admin/support-cases`에서 미확인 RED 사건을 안전 담당자가 확인한다.
5. Production deployment가 `READY`이고 두 공개 alias가 같은 deployment인지 확인한다.
6. 대량 발송을 승인하지 않은 기간에는 네 개 안전 플래그가 위 기준과 같은지 확인한다.

화면이나 보고서에 전화번호, 이메일, 주소, raw 답변을 복사하지 않는다. 통계와 ID가
필요하면 권한이 분리된 관리자 화면 또는 마스킹된 운영 도구를 사용한다.

## Cron

기본 `vercel.json`은 Vercel Hobby 제약에 맞춘다. 시간대는 UTC다.

| 작업 | 경로 | schedule | KST 기준 |
|---|---|---|---|
| 최초 체크인 | `/api/cron/weekly-checkins` | `0 9 * * 0` | 일요일 18시대 |
| 리마인드 | `/api/cron/checkin-reminders` | `0 9 * * 1` | 월요일 18시대 |
| 메시지/outbox/housekeeping | `/api/cron/checkin-outbox` | `10 9 * * *` | 매일 18시대 |

Hobby는 일 1회·시간 단위 정밀도이므로 실제 시작 시각은 같은 시간대 안에서 달라질 수
있고 실패 실행을 자동 재시도하지 않는다. 10분 주기가 필요하면 유료 승인을 받은 뒤
`vercel.pro.json`을 별도로 검토·배포한다. 요금제 변경은 코드 배포와 분리한다.

Cron route는 16자 이상의 `CRON_SECRET`을 요구한다. secret 원문을 curl 명령, ticket,
shell history에 넣지 않는다. 수동 호출은 장애 대응 승인 하에서 process environment로
주입하고 request ID와 집계만 남긴다.

## 안전한 배포

배포 전에 `docs/DEPLOYMENT_CHECKLIST.md`를 완료한다. 최소 게이트는 다음과 같다.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:integration
pnpm build
pnpm audit --prod
supabase db reset
supabase db lint --local --fail-on error
```

1. Production 변경 전 Git 밖의 신규 경로에 logical backup을 만들고 검증한다.
2. schema 변경은 기존 migration을 편집하지 않고 신규 timestamp migration만 사용한다.
3. 깨끗한 로컬 DB에서 전체 migration과 개발 seed를 재생한다.
4. branch PR에서 CI와 secret/forbidden-file scan을 통과한다.
5. `main` merge SHA를 확인한 뒤 같은 SHA로 Vercel Production을 배포한다.
6. deployment가 `READY`이고 public alias가 새 deployment를 가리키는지 확인한다.
7. `/`, `/privacy/checkin`, `/admin/login`, 비로그인 admin redirect/API 차단, 임의 token
   오류, security header를 확인한다.
8. 배포 전후 운영 row 수, 관리자 수, invitation/outbox 수가 의도치 않게 변하지 않았는지
   확인한다.

Production validation fixture는 승인 문자열과 고유 run ID가 있을 때만 사용하며,
`is_test=true`, 외부 발송 0건, exact-ID cleanup을 반드시 검증한다. 개발 seed를
Production에 적용하지 않는다.

## 중지와 복구

메시징 오발송 위험이 있으면 먼저 다음 네 값의 Production 상태를 안전 기준으로 되돌린
뒤 동일 소스 deployment를 다시 배포한다. 실제 값을 로그에 출력하지 않는다.

- `CHECKIN_SENDING_ENABLED=false`
- `ENABLE_SMS_FALLBACK=false`
- `MESSAGING_PROVIDER=disabled`
- `ALLOW_DEV_ADMIN=false`

DB schema는 destructive down migration으로 되돌리지 않는다. 직전 호환 코드 배포,
read-only 진단, 승인된 forward migration 순서로 복구한다. 데이터 복구는
`docs/BACKUP_RESTORE_RUNBOOK.md`, 보안·안전 사고는 `docs/INCIDENT_RESPONSE.md`를 따른다.

## URL bearer token 제한

현재 발송 링크 `/checkin/{token}`은 기존 초대 호환성을 위해 유지한다. 토큰은 256-bit
opaque 값이며 DB에는 hash만 저장되고, 체크인 응답은 `no-store`, `no-referrer`,
`noindex` 정책을 사용한다. 애플리케이션 오류 로그는 raw URL/token을 기록하지 않는다.
그럼에도 CDN·플랫폼 request-path log에는 최초 URL이 남을 수 있으므로 다음을 지킨다.

- 체크인 경로의 Analytics·Log Drain 수집과 보존을 최소화한다.
- 운영 ticket, screenshot, 채팅에 전체 링크를 붙이지 않는다.
- 접근이 의심되면 해당 invitation을 폐기하고 새 초대를 발급한다.

이번 릴리스에서 HttpOnly session 교환을 즉흥 도입하지 않는 이유는 기존 page/API/token
만료·완료·다중 기기 계약을 동시에 바꿔 장애 범위가 더 크기 때문이다. 후속 변경은
다음 계약을 하나의 독립 릴리스로 구현한다: 최초 token 검증 → 단일 목적의 짧은 수명
HttpOnly/Secure/SameSite 쿠키 → token 없는 URL로 303 → cookie 기반 tokenless API →
회전·폐기·동시 탭·만료·완료·로그 redaction E2E. 기존 발송 링크는 교환 endpoint로만
호환한다.

## 관련 문서

- `docs/INCIDENT_RESPONSE.md`
- `docs/BACKUP_RESTORE_RUNBOOK.md`
- `docs/ACCESS_CONTROL.md`
- `docs/DATA_RETENTION.md`
- `docs/DEPLOYMENT_CHECKLIST.md`
- `docs/ALIMTALK_INTEGRATION.md`
- `docs/OPERATIONAL_IMPORT.md`

공식 참고: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups),
[Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing).
