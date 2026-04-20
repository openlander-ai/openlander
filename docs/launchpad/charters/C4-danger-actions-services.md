# Charter C4: DangerActions_AND_SERVICES

**Tier**: Zero-Tolerance
**예상 소요**: 45분

## 1. Pre-condition

- 임시 프로젝트 3개:
  - `qa-c4-purge-target` (test-single-dockerfile, running)
  - `qa-c4-archive-target` (test-single-dockerfile, running)
  - `qa-c4-svc-consumer` (test-env-required, env에 DATABASE_URL 주입 예정)
- 임시 서비스 1개:
  - `qa-c4-pg` (PostgreSQL 17, ServicesPage에서 생성)

## 2. Scenarios

### C4S1_STOP_CONFIRM_DIALOG

`qa-c4-archive-target` → header → Stop 클릭 → ConfirmDialog 표시 → Cancel → 다시 Stop → Confirm.
**PASS**: Cancel 시 status 변화 없음. Confirm 시 30초 안에 status='stopped'.

### C4S2_ARCHIVE_UNARCHIVE

위 프로젝트 → header → Archive → Confirm → ProjectsGrid에서 'Show Archived' off일 때 안 보임 → 토글 on → 보임 → Unarchive 클릭.
**PASS**: 토글 동작 정확 + Unarchive 후 즉시 Show Archived 없이도 표시.

### C4S3_PURGE_TEXT_MATCH

`qa-c4-purge-target` → header → Purge → PurgeDialog 노출 → 이름 부분만 입력(예: `qa-c4`) → Confirm 버튼 disabled 확인 → 정확한 이름 입력 → Confirm enabled → Confirm.
**PASS**: 부분 일치 시 disabled 유지 + Purge 후 ProjectsGrid에서 사라짐 + `docker ps -a` 잔여 없음.
**FAIL**: 부분 일치로 Confirm 가능 또는 Purge 후 다른 프로젝트 영향.

### C4S4_DOUBLE_REDEPLOY_LOCK (BUG-002 회귀)

`qa-c4-archive-target` (Unarchive 후) → header Redeploy 클릭 → 50ms 안에 다시 클릭 (자동화: 10회 반복).
**PASS**: 2회차 이후 모두 disabled 또는 거부 토스트 + Docker container 중복 생성 0회.
**FAIL**: 두 개 이상의 동시 빌드 발생 또는 409 Conflict 발생.

### C4S5_VOLUME_DUPLICATE_PATH (BUG-008 회귀)

`qa-c4-archive-target` → Settings → Volumes (또는 해당 섹션) → 같은 mount path로 2번째 volume 추가 시도.
**PASS**: UI 즉시 거부 + 명확한 에러.

### C4S6_SERVICE_CREATE_AND_LINK (S1)

ServicesPage → Create Service → PostgreSQL 17 템플릿 → 이름 `qa-c4-pg` → Create.
ServiceDetail 진입 → Connection 탭에서 connection string 복사 가능 확인.
프로젝트 `qa-c4-svc-consumer` Settings → Env vars → DATABASE_URL 추가 (위 connection string) → Redeploy.
**PASS**: 프로젝트 status='running' (env 주입 성공).

### C4S7_SERVICE_DELETE_NO_WARN_BUG (BUG-009 회귀, 의심 버그)

`qa-c4-pg` ServiceDetail → header → Delete 클릭.
**확인 항목**:

- 다이얼로그가 뜨는가? (현재는 의심대로 즉시 삭제)
- 사용 중인 프로젝트(`qa-c4-svc-consumer`) 경고가 표시되는가?
- 삭제 후 프로젝트의 env vars 어떻게 되는가?
  **PASS (이상적)**: 삭제 전 다이얼로그 + 사용 프로젝트 1개 경고 표시 + 사용자가 진행 선택 시 env vars cleanup 결과 노출.
  **현재 상태 인정 (FAIL → 1.0 차단)**: 다이얼로그 없이 즉시 삭제. 이는 BUG-009 미해결로 기록 → No-Go 사유.

## 3. Output

표준 5섹션 + 특별 항목:

- C4S4의 더블클릭은 Playwright 자동화로 정확한 ms 간격 기록
- C4S7는 현 동작을 정확히 캡처 (스크린샷 + 네트워크 요청 시퀀스)

## 4. Cleanup

```bash
# UI: 잔여 프로젝트/서비스 모두 Purge
docker ps -a --filter name=qa-c4-
docker volume ls --filter name=qa-c4-
```

## 5. Refs

- `web/src/pages/ProjectDetail.tsx:286-337` (archive/purge)
- `web/src/pages/ServiceDetail.tsx:75-86` (delete)
- BUG-002/008/009
