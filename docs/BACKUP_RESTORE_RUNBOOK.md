# HomeTogether Weekly Check-in Backup and Restore Runbook

## 목적과 안전 경계

이 문서는 application logical backup을 만들고 검증하며, Git 밖의 백업을 격리된 로컬
Supabase에서 복구 연습하는 절차다. 이 도구는 다음 항목을 대체하지 않는다.

- Supabase managed backup 또는 Point-in-Time Recovery(PITR)
- `pg_dump`/`pg_restore`로 만든 전체 PostgreSQL 사본
- Auth 비밀번호, 세션, MFA factor 및 identity secret 복구
- Supabase Storage object body 복구
- migration 이전에 별도로 만들어진 legacy schema의 원본 DDL

Production DB를 restore drill 대상으로 사용하지 않는다. restore drill 도구는 로컬 Docker
daemon의 `supabase_db_<config.toml project_id>` 컨테이너만 허용하며, 모든 replay를 하나의
transaction에서 수행한 뒤 항상 `ROLLBACK`한다.

## 1. Logical backup 생성

백업 디렉터리는 Git repository 밖의 새 절대경로여야 한다. 기존 경로를 덮어쓰지 않는다.
환경변수의 실제 값은 로그나 명령 인자로 출력하지 않는다.

```bash
export PRODUCTION_BACKUP_ACK=I_ACKNOWLEDGE_SENSITIVE_PRODUCTION_BACKUP
pnpm backup:logical -- --output /absolute/git-external/new-backup-directory
pnpm backup:verify -- --directory /absolute/git-external/new-backup-directory
```

생성 디렉터리는 `0700`, 파일은 `0600`이다. `SHA256SUMS`에는 manifest를 포함한 모든
backup payload의 SHA-256이 기록된다. verifier는 다음을 거부한다.

- 상대경로, path traversal 이름, 중복 checksum 항목
- backup directory 또는 내부 파일의 symlink
- hard link 및 일반 파일이 아닌 entry
- group/other 읽기·쓰기·실행 권한이 열린 directory 또는 파일
- checksum 불일치, 누락/추가 파일, manifest와 실제 row count 불일치
- manifest migration 목록·migration별 SHA-256과 실제 `migrations.sql` bundle의 불일치

exporter는 Git이 추적하는 migration만 bundle에 넣는다. working tree의 SQL 파일 목록과
`git ls-files` 결과가 다르면 승인·commit되지 않은 migration을 백업 증거로 잘못 포함하지 않도록
실패한다. 출력 경로도 현재 Git repository 밖의 기존 parent 아래 새 directory만 허용한다.

### Migration history 표시

새 v3 manifest는 migration 이름을 하드코딩하지 않는다.

- `SUPABASE_ACCESS_TOKEN`이 안전한 process environment에 있으면 Supabase Management API로
  remote migration version을 읽고 local migration version과 정확히 비교한다.
- URL에서 얻은 project ref와 `SUPABASE_PROJECT_REF`가 다르면 backup은 실패한다.
- 두 집합이 같을 때만 `migrationHistory.status=MATCHED`와
  `remoteMigrationHistoryComplete=true`를 기록한다.
- 다르면 `MISMATCHED`와 `remoteOnlyVersions`/`localOnlyVersions` 및 각각의 count를 기록한다.
- access token이 없으면 `NOT_CHECKED`이며 completeness를 주장하지 않는다.

Production 적용 전 additive migration이 local-only이면 새 table이 아직 원격에 없는 것이 정상일 수
있다. exporter는 임의의 missing/inaccessible table을 무시하지 않는다. 코드에 table과 도입 migration
version의 좁은 mapping이 있고, 그 version이 실제 `localOnlyVersions`에 있을 때만 해당 table을 0행
파일로 만들고 `tablesAbsentPendingMigration`에 근거를 기록한다. 현재 허용된 mapping은
`message_delivery_receipts`와 이를 만드는 `20260809090828` migration뿐이다. 다른 table 누락,
history `NOT_CHECKED`, 또는 적용 완료 후 table 누락은 모두 실패한다.

`MATCHED`는 Supabase migration version history의 일치만 뜻한다. migration history 밖에서
만들어진 legacy table DDL까지 재현 가능하다는 뜻이 아니며, native backup/PITR라는 뜻도
아니다. 기존 v2 backup은 기존 disclosure를 보존한 채 verifier와 호환된다.

## 2. 보관 및 접근

1. backup은 Git, Vercel build context, 공유 Drive 기본 폴더에 두지 않는다.
2. 암호화된 offsite 저장소와 접근 담당자를 별도로 정한다.
3. 파일 내용 대신 경로, 파일 수, checksum, 생성시각만 incident/change record에 남긴다.
4. 개인정보 접근 로그와 보존/파기 일정을 운영 정책으로 승인한다.
5. Storage를 사용한다면 DB와 별도의 object inventory 및 checksum backup을 만든다.

## 3. 격리 로컬 restore drill

### 전제조건

- Docker context가 local Unix socket 또는 Windows named pipe를 사용한다.
- `supabase/config.toml`의 project ID가 현재 repository 전용 값이다.
- 깨끗한 local Supabase schema를 seed 없이 준비한다.
- 실제 Production URL, DB URL, access token, service key는 restore 명령에 제공하지 않는다.

```bash
supabase start --exclude studio,imgproxy,edge-runtime,logflare,vector
supabase db reset --local --no-seed

export RESTORE_DRILL_ACK=I_ACKNOWLEDGE_LOCAL_ROLLBACK_RESTORE_DRILL
pnpm backup:restore-drill -- \
  --directory /absolute/git-external/backup-directory
```

도구는 먼저 checksum과 inventory를 다시 검증하고, 대상 `auth.users`와 일반 application
table이 비어 있는지 확인한다. migration 자체가 기준 lookup으로 만드는 `universities`와
`university_email_domains`만 예외다. 두 table의 시작 count를 기록하고 transaction 안에서만
자식→부모 순서로 비운 뒤 backup row를 replay하며, `ROLLBACK` 뒤 시작 count와 정확히 같은지
다시 확인한다. 이 두 table 이외의 preloaded application row나 Auth user가 있으면 실패한다.

Auth export는 FK 검증을 위한 로그인 불가능 placeholder row로만 replay한다. 비밀번호, session,
identity secret은 복구하지 않는다. table row는 foreign key와 trigger를 끄지 않고 dependency
order로 replay하며, count를 확인한 뒤 transaction 전체를 rollback한다.

### Legacy schema가 없는 경우

현재 checked-in migration은 `app_records`, `app_members`, `app_files`의 원본 DDL을 만들지
않는다. 이 table에 backup row가 있으나 로컬 schema에 table이 없으면 기본 동작은 실패다.
운영 기록에 이 복구 gap을 명시한 뒤 current managed schema만 부분 검증하려는 경우에만
다음을 사용한다.

```bash
pnpm backup:restore-drill -- \
  --directory /absolute/git-external/backup-directory \
  --allow-partial-legacy
```

이 옵션은 위 세 legacy table만 허용한다. 다른 managed table이 없으면 항상 실패한다. 결과의
`skippedLegacyTables`, row count, `partialLegacyRestore`를 복구 증거에 기록한다. 이 결과를
“전체 application restore 성공”으로 표현하면 안 된다.

## 4. 실제 장애 복구 절차

1. Cron, check-in sending, SMS fallback, provider/webhook dispatch를 먼저 중지한다.
2. 장애 DB를 삭제하지 말고 request ID, migration version, row count를 읽기 전용으로 기록한다.
3. 최신 managed backup/PITR가 있으면 원본 project가 아닌 새 격리 project에 복원한다.
4. logical backup만 있으면 먼저 schema source와 legacy DDL의 완전성을 확인한다. 이 runbook의
   rollback drill 도구를 Production 적용 도구로 사용하지 않는다.
5. 새 project에서 migration history, constraints, RLS, grants, Auth, application counts,
   Storage를 검증한다.
6. 보안 검토와 change approval 뒤 Vercel environment를 새 project로 전환해 배포한다.
7. anonymous denial, 관리자 로그인, 공개 check-in, outbox 0건, 메시징 비활성을 smoke test한다.
8. 사고 종료 뒤 backup 접근 기록과 임시 복원 project를 승인된 절차로 정리한다.

## 4.1 2026-08-09 기준 rollback drill 증거

기존 승인된 v2 기준 backup을 수정하지 않고 검증했다. 실제 로컬 절대 경로는 Git 문서에
기록하지 않는다.

- checksum payload 33개 검증 성공
- local 17-migration schema에서 managed table 26개, row 49개 replay/count 검증
- Auth user 1건은 로그인 불가능 FK placeholder로만 검증
- migration-owned lookup table 2개의 시작 baseline을 transaction rollback 뒤 재확인
- unmanaged legacy DDL이 없어 `app_records` 9행, `app_members` 1행, `app_files` 0행은
  명시적으로 제외
- transaction rollback 및 사후 target baseline 불변 확인
- Production 접근 0건, Auth secret/Storage object body 복원 0건

따라서 이 결과는 **managed schema 부분 복구 drill 성공**이며 전체 application 복구 성공이
아니다. legacy 10행을 복구하려면 원본 DDL과 dependency 검증이 먼저 필요하다.

## 5. RPO/RTO 초안

| 항목 | 현재 상태 | 운영 목표 초안 |
|---|---|---|
| RPO | 수동 logical backup 이후 변경은 보호되지 않아 보장 불가 | managed daily backup 활성화 시 24시간 이하; 더 짧은 목표는 PITR 필요 |
| RTO | full restore drill과 legacy DDL이 없어 보장 불가 | 초기 목표 4시간, 실제 격리 복구 측정 뒤 승인 |
| Auth 복구 | metadata/FK placeholder만 검증 가능 | Auth/identity 공식 복구 절차와 운영자 재인증 계획 필요 |
| Storage 복구 | object body 미포함 | 별도 object backup과 정기 checksum drill 필요 |

유료 plan 구매나 PITR 활성화는 이 repository 작업의 범위가 아니다. 운영자가 비용과 목표를
승인하기 전에는 managed backup/PITR를 `MISSING`으로 유지한다.

## 6. Drill 성공 기준

- checksum과 exact inventory가 통과한다.
- symlink/path traversal/hard-link 방어 테스트가 통과한다.
- local schema의 managed table replay와 manifest count가 일치한다.
- transaction이 `ROLLBACK`되고 drill 뒤 Auth/일반 application row는 0건이며 migration-owned
  lookup table count는 drill 전 baseline과 같다.
- Production 접근과 메시지 발송이 0건이다.
- legacy/Auth/Storage/PITR 제외 범위가 결과와 change record에 남는다.
