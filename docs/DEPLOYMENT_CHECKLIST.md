# Production Deployment Checklist

## 1. GitHub repository gate

- [ ] PR은 `main` 최신 commit에서 분기했다.
- [ ] 기존 migration 파일을 수정·삭제·이름 변경하지 않았고 신규 migration만 추가했다.
- [ ] 실제 `.env`, ZIP, backup, customer CSV, DB dump, test output가 tracked되지 않았다.
- [ ] `CI / Quality and build`가 통과했다.
- [ ] `CI / Secret scan`이 redacted mode로 전체 Git history를 검사해 통과했다.
- [ ] `CI / Local Supabase migration replay`가 migration + development seed replay와 DB lint를
      통과했다.
- [ ] branch protection에서 위 세 check를 required로 설정했다.
- [ ] force push와 branch deletion 권한을 제한했다.

일반 CI에는 Production credential이 없다. Node 22, pnpm 10.28.0, frozen lockfile install,
lint, typecheck, unit/repository test, integration test, build, migration inventory, forbidden-file
검사와 production dependency audit를 수행한다.

## 2. Protected Production validation 설정

GitHub repository에 `production-validation` Environment를 만들고 required reviewer와 deployment
branch를 `main`으로 제한한다. 아래 이름의 environment secret만 등록하고 값은 문서, issue,
workflow YAML에 적지 않는다.

- `PRODUCTION_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

`.github/workflows/production-validation.yml`은 `workflow_dispatch`로만 실행된다.

- `read-only-preflight`: URL과 test-isolation schema를 읽기 전용으로 확인한다.
- `isolated-fixture-e2e`: Environment reviewer 승인과 두 acknowledgement가 모두 필요하다.
  exact-ID/is_test fixture만 만들고 검증 후 항상 cleanup한다.

실제 고객 데이터와 실제 메시지는 이 workflow에서 사용하거나 발송하지 않는다. cleanup이
실패하면 workflow를 실패로 유지하고 같은 run ID의 exact fixture만 별도 승인 절차로 정리한다.

## 3. Release 전 로컬 검증

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm repository:safety`
- [ ] `pnpm migrations:validate`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:coverage`
- [ ] `pnpm test:integration`
- [ ] `pnpm build`
- [ ] `pnpm audit --prod`
- [ ] `supabase start`
- [ ] `supabase db reset --local`
- [ ] `supabase db lint --local --fail-on error`

## 4. DB 변경 gate

- [ ] 변경 전 새 Git-external logical backup과 `backup:verify`를 완료했다.
- [ ] v3 manifest의 migration status가 정확하다. 적용 전 신규 additive migration 때문에
      `MISMATCHED`라면 remote-only는 0이고 local-only가 이번 승인 migration과 정확히 같아야 한다.
      새 table이 아직 없는 경우 `tablesAbsentPendingMigration`도 승인 migration mapping과 일치해야
      한다. `NOT_CHECKED`, 예상하지 않은 remote-only/local-only, 임의 table 누락이면 적용하지 않는다.
- [ ] logical backup이 native backup/PITR가 아님을 change record에 명시했다.
- [ ] `DROP TABLE`, `DROP COLUMN`, 대량 `DELETE`, 축소 cast, unsafe `NOT NULL`, 관리자 잠금
      가능성을 별도로 검토했다.
- [ ] 빈 local DB에서 migration 전체와 seed를 처음부터 재생했다.
- [ ] additive migration만 승인된 방식으로 적용한다. `db reset --linked`, migration repair,
      destructive rollback은 사용하지 않는다.
- [ ] 적용 뒤 Local/Remote migration version, DB lint, 관리자 수, 운영 row count, invitation과
      outbox 불변을 확인한다.

## 5. Vercel 배포 gate

- [ ] 배포 source SHA가 승인·merge된 `origin/main` SHA와 같다.
- [ ] 필수 Production environment variable은 이름과 SET/MISSING만 확인한다.
- [ ] `CHECKIN_SENDING_ENABLED=false`
- [ ] `ENABLE_SMS_FALLBACK=false`
- [ ] `MESSAGING_PROVIDER=disabled`
- [ ] `ALLOW_DEV_ADMIN=false`
- [ ] `ADMIN_BOOTSTRAP_SECRET`가 제거돼 있다.
- [ ] 기존 deployment rollback이나 로컬 untracked 파일 upload가 아닌 승인된 source를 배포한다.
- [ ] deployment가 `READY`가 될 때까지 기다린다.

## 6. 배포 후 검증

- [ ] `/`, `/privacy/checkin`, `/admin/login`이 정상 응답한다.
- [ ] 비로그인 `/admin/*`와 관리자 API가 redirect 또는 401/403으로 차단된다.
- [ ] 임의/만료 token이 안전한 404/410으로 처리된다.
- [ ] `no-store`, `noindex`, `no-referrer` 등 route별 보안 header를 확인한다.
- [ ] 활성 SUPER_ADMIN이 유지되고 bootstrap secret은 없다.
- [ ] outbox, integration outbox, invitation, 실제 메시지 발송이 0건 유지된다.
- [ ] 필요하면 protected manual Production validation을 실행하고 exact fixture cleanup을 확인한다.

## 7. Rollback/복구 준비

- [ ] [BACKUP_RESTORE_RUNBOOK.md](./BACKUP_RESTORE_RUNBOOK.md)의 checksum verification을
      완료했다.
- [x] 격리 local rollback restore drill 결과와 누락 legacy schema를 기록했다.
- [ ] managed backup/PITR, Storage backup, Auth recovery의 실제 가용 상태를 기록했다.
- [ ] schema rollback보다 호환 code와 승인된 forward migration을 우선한다.
- [ ] 장애 중에는 Cron과 모든 message/webhook dispatch를 비활성화한다.
