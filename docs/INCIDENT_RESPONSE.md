# Incident Response

이 문서는 사람 안전, 개인정보, 인증, 데이터, 메시징과 배포 장애의 최소 대응 절차다.
secret·token·전화번호·주소·raw 답변은 incident ticket이나 채팅에 복사하지 않는다.

## 우선순위

1. **사람 안전:** RED 응답, 폭력·위협·긴급 보호 필요. 기술 복구보다 승인된 안전 담당자
   연락·기관 절차를 우선한다.
2. **개인정보/계정 침해:** token 노출, 관리자 탈취, 권한 우회, 데이터 유출 가능성.
3. **오발송/외부 연동:** 잘못된 대상, 중복 발송, 잘못된 webhook 전달.
4. **데이터 무결성:** 응답 누락·중복, migration 오류, 잘못된 import.
5. **가용성:** 공개 체크인, 관리자, Cron 또는 provider 장애.

## 즉시 조치

- 메시징 관련 사고면 Production의 `CHECKIN_SENDING_ENABLED=false`,
  `ENABLE_SMS_FALLBACK=false`, `MESSAGING_PROVIDER=disabled`를 유지·재확인한다.
- 실제 provider credential을 임의로 삭제하지 않는다. 승인된 secret rotation 절차를 쓴다.
- Cron 실패를 수동으로 반복 호출하기 전에 idempotency key, lease, retry 수와 provider
  acceptance 여부를 확인한다.
- 관리자 계정 침해가 의심되면 해당 membership을 비활성화하고 Auth session revoke를
  수행하되 마지막 활성 `SUPER_ADMIN`은 잠그지 않는다.
- 데이터 쓰기를 중지할 필요가 있으면 영향 범위를 확인하고 최소 범위만 차단한다.
  Production DB reset, 전체 삭제, migration repair를 사용하지 않는다.

## 증거 보존

다음 비식별 정보만 기록한다.

- incident 시작/발견/종료 시각과 시간대
- Vercel deployment ID와 Git commit SHA
- request ID, Cron job 이름, provider message ID의 내부 참조값
- 영향을 받은 row의 개수와 마스킹된 범위
- 관련 migration version과 error code
- 취한 kill switch, rollback/forward-fix, 검증 결과

전체 URL token, HTTP Authorization/Cookie, 환경변수 값, 고객 CSV, DB dump, raw response를
ticket에 첨부하지 않는다. 민감 증거가 필요하면 Git 밖의 접근 제한·암호화된 사고
보관소에 두고 보존기한을 기록한다.

## 유형별 점검

### 사람 안전

1. `/admin/support-cases`에서 권한 있는 담당자가 사건을 확인한다.
2. 사건 원문을 일반 ticket로 복사하지 않고 앱의 case action/audit를 사용한다.
3. `UNACKNOWLEDGED` → 확인 → 연락/중재/모니터링 상태를 실제 조치와 맞춘다.
4. 자동 상대방 통지나 무단 외부 발송을 하지 않는다.

### token 또는 개인정보 노출

1. 노출된 invitation과 접근 시각을 최소 범위로 식별한다.
2. 해당 invitation을 폐기하고 필요 시 새 token을 발급한다.
3. Vercel/Cloudflare/Supabase log 접근자를 제한하고 보존 정책을 확인한다.
4. RLS, 익명 API, 관리자 API와 CSV export 권한을 재검증한다.
5. 법적·계약상 통지 필요 여부는 개인정보 책임자가 판단한다.

### 메시지 중복·오발송

1. 세 발송 안전값을 비활성으로 고정한다.
2. `message_logs`, `message_attempts`, callback receipt와 provider console을 ID 기준으로
   대조한다.
3. timeout/unknown 상태는 provider 조회로 확정하기 전 재발송하지 않는다.
4. replayed callback, 잘못된 idempotency 또는 lease 만료 원인을 분리한다.
5. 대량 발송은 내부 단건 수신과 callback 검증 후 별도 승인한다.

### migration/DB 무결성

1. Local/Remote migration version과 배포 SHA를 읽기 전용으로 비교한다.
2. 변경 전 backup checksum을 검증한다.
3. 호환 코드 또는 신규 forward migration을 우선한다.
4. 복구가 필요하면 격리 환경 restore drill 후 승인된 절차를 사용한다.
5. 운영 row count, 관리자 수, invitation/outbox를 전후 비교한다.

### 배포 장애

1. custom/default domain과 Vercel deployment `READY` 상태를 확인한다.
2. `/`, `/privacy/checkin`, `/admin/login`과 비로그인 차단을 확인한다.
3. 새 코드가 원인이면 직전 정상 **호환** deployment 복원을 검토한다.
4. Cron은 Vercel rollback만으로 schedule이 갱신되지 않을 수 있으므로 Cron 설정을 별도
   확인한다.

## 복구 완료 조건

- 사람 안전 조치가 담당자에게 인계됨
- 공개 check-in과 관리자 경계가 정상
- 비로그인 관리자 화면/API 차단
- DB migration history와 schema health 정상
- 실제 메시지·webhook의 추가 발송이 없음
- outbox/lease/retry가 설명 가능한 상태
- backup 또는 forward-fix 검증 완료
- 재발 방지 owner와 기한이 지정됨

사후 보고에는 원인, 영향 개수, 타임라인, 복구와 회귀 테스트만 남기고 개인정보는
포함하지 않는다.
