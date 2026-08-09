# Operational Data Import

이 문서는 실제 HOST/GUEST/home/ACTIVE match를 안전하게 미리보기·검증·반영하는 절차다.
실제 CSV와 생성된 plan은 Git, PR, chat, 일반 build log에 넣지 않는다.

현재 Git 외부 경로에서 사용자 승인을 확인할 수 있는 실제 `APPROVED` 고객 CSV는
발견되지 않았다. 따라서 dry-run과 apply는 모두 `NOT RUN`이며, 가짜 example을
Production에 입력하지 않는다.

## 입력 계약

개인정보 없는 공식 예시는 `docs/examples/hometogether-operational-import-template.csv`다.
한 행은 하나의 계약과 아래 관계를 표현한다.

- source/contract: `source_system`, `contract_external_id`, status/start/end
- home: external ID, 이름, 주소, 지역, 활성 여부
- HOST profile: external ID, 이름, 전화, 이메일, 활성 여부, 수신 동의
- GUEST profile: external ID, 이름, 전화, 이메일, 활성 여부, 수신 동의

운영 대상이 되려면 profile/home이 활성이고, 현재 날짜에 유효한 `ACTIVE` match가 정확히
하나이며, 수신 동의가 true이고, 전화번호가 정규화 가능한 한국 휴대전화 형식이어야
한다. 동의·전화·계약 관계를 추정하지 않는다.

## 파일 보관

- 허용된 Git 밖 디렉터리만 사용한다.
  - `~/Documents/HomeTogether-Operational-Imports/`
  - `~/Documents/HomeTogether-Production-Imports/`
- 디렉터리는 0700, 실제 CSV는 0600을 권장한다.
- symlink, ZIP, DB dump, 여러 승인 후보를 자동 입력으로 사용하지 않는다.
- 파일명에 `APPROVED` 또는 `approved`가 있어도 내용 검증을 생략하지 않는다.
- 이름·전화·이메일·주소와 issue를 CLI 출력이나 최종 보고에 표시하지 않는다.

## Dry-run

Vercel Production environment는 디스크에 pull하지 않고 승인된 일회성 환경 주입을
사용한다. 실제 secret을 shell argument에 넣지 않는다.

```bash
pnpm migrate:checkin-data -- --file /absolute/path/approved.csv --dry-run
```

dry-run은 Supabase의 기존 profile/home/match/invitation을 읽고 plan을 만들지만 DB를
수정하지 않는다. 다음만 검토한다.

- profile/home/match 생성·갱신·unchanged 수
- error/warning/duplicate/excluded 수
- 역할과 관계 오류
- 누락 필수값과 수신 동의
- 잘못된 전화번호
- 한 사람의 중복 현재 ACTIVE match
- file SHA와 plan SHA

오류 또는 경고가 하나라도 있으면 자동 apply하지 않는다. 출력은 issue code와 row
number만 공유하고 원본 cell 값을 공유하지 않는다.

## Apply 게이트

적용 전 다음 조건을 모두 만족해야 한다.

1. 승인 CSV가 Git 밖에 정확히 하나 있고 symlink가 아니다.
2. dry-run이 error/warning 없이 깨끗하다.
3. 검토한 plan SHA가 apply 시점 plan SHA와 같다.
4. Production logical backup을 신규 경로에 생성하고 verify했다.
5. 활성 `SUPER_ADMIN`이 존재한다.
6. `CHECKIN_SENDING_ENABLED=false`, `ENABLE_SMS_FALLBACK=false`,
   `MESSAGING_PROVIDER=disabled`가 유지된다.
7. invitation/message/integration outbox가 비어 있거나 기존 상태가 설명 가능하다.

공식 apply는 reviewed SHA와 실제 `SUPER_ADMIN` user ID를 사용한다.

```bash
pnpm migrate:checkin-data -- --file /absolute/path/approved.csv --apply \
  --confirm <reviewed-plan-sha256> --admin-id <super-admin-uuid>
```

명령은 source external ID 기반으로 멱등 계획을 만들고 DB RPC의 단일 transaction에서
반영한다. client가 보낸 생성·갱신 수를 신뢰하지 않고 서버가 입력과 현재 DB 상태를
다시 검증한다. plan SHA가 달라지면 중단하고 새 dry-run부터 검토한다.

## 적용 후 확인

- profile/home/match와 현재 `ACTIVE` 수가 plan과 일치
- 각 운영 참여자의 현재 ACTIVE match가 정확히 하나
- 동의 없는 profile, 잘못된 phone, 비활성 home/profile은 대상에서 제외
- invitation, message outbox, integration outbox 신규 row 0
- 실제 메시지·SMS·webhook 발송 0
- 발송 안전 플래그 유지
- 동일 CSV 재 dry-run 시 의도치 않은 신규 create 0
- import audit는 개수·hash만 보존하고 원문 PII를 포함하지 않음

운영 데이터 import와 주간 invitation 생성은 별도 작업이다. import 직후 Cron을 수동으로
실행하지 않는다.

## 보존과 폐기

import staging row의 PII는 DB housekeeping 정책에 따라 만료 후 redaction한다. 원본 CSV의
보존·삭제는 `docs/DATA_RETENTION.md`와 조직의 개인정보 정책을 따른다. Git history,
logical backup manifest, PR 또는 issue에는 원본을 넣지 않는다.
