# Charter C3: Recovery_ROLLBACK_BLUEGREEN

**Tier**: Zero-Tolerance
**예상 소요**: 60분

## 1. Pre-condition

- 임시 프로젝트 2개:
  - `qa-c3-bg` (test-single-dockerfile, running)
  - `qa-c3-crash` (test-runtime-crash, running)
- LLM 등록됨 (auto-recovery 시나리오용)
- `circuit-breaker` 상태가 closed (Settings/Operations에서 확인)

## 2. Scenarios

### C3S1_ROLLBACK_2DEPLOYS (BUG-004 회귀)

`qa-c3-bg` Redeploy 1회 → 성공 후 다시 Redeploy 1회 → ProjectDetail header → Rollback 클릭 → RollbackDialog에서 첫 번째 deployment 선택 → Confirm.
**PASS**: 60초 안에 status='running' + timeline에 'ENETUNREACH' 또는 'ECONNREFUSED' 0회.
**FAIL**: rollback 실패 토스트 또는 timeline에 네트워크 에러.

### C3S2_BLUEGREEN_HEALTHCHECK (BUG-003 회귀)

`qa-c3-bg` → Blue-Green 클릭 → BlueGreenDialog에 health check path `/` → Confirm.
**PASS**: 30초 헬스체크 통과 후 신구 컨테이너 전환 + 기존 컨테이너는 30초 동안 status='running' 유지 (`docker ps`로 확인).
**FAIL**: 헬스체크 실패 메시지 + 기존 컨테이너 stopped.

### C3S3_BLUEGREEN_FAILED_FALLBACK (BUG-016 회귀)

`qa-c3-bg` → 다른 터미널에서 인위적으로 다음 빌드를 실패시킴 (예: 환경변수에 잘못된 PORT 주입) → Blue-Green Confirm.
**PASS**: 신규 컨테이너 실패 시 기존 컨테이너가 계속 running, UI에 명확한 실패 메시지.

### C3S4_AUTO_RECOVERY_DISPLAY (R1 회귀)

`qa-c3-crash` 진입 → 다른 터미널에서 `docker kill qa-c3-crash` (또는 컨테이너 ID).
ProjectDetail Operations 탭 또는 OpsCenter 모니터.
**PASS**: 60초 안에 activity feed에 `container:die` → `recovery:started` (순서 검증은 best-effort) → `recovery:success` 또는 `recovery:exhausted`. UI 무한 로딩 0회.

### C3S5_RECOVERING_THEN_STOP (CC1 cross-cutting)

C3S4 진행 중 status='recovering' 보일 때 즉시 ProjectDetail header → Stop 클릭 → ConfirmDialog confirm.
**PASS**: 30초 안에 status='stopped' 안정 + activity feed 일관 (recovery 이벤트와 stop 이벤트 모순 없음).
**FAIL**: status가 recovering에 stuck 또는 모순된 이벤트.

## 3. Output

표준 5섹션 + 특별 항목:

- 각 시나리오마다 timeline 이벤트 시퀀스 캡처 (3~5개 이벤트)
- BUG-004 검증: timeline 텍스트 grep으로 'ENETUNREACH' 라인 수 0 확인
- C3S5는 cross-cutting 위험 시나리오라 상세 로그 첨부

## 4. Cleanup

```bash
# UI: Purge qa-c3-bg, qa-c3-crash
docker ps -a --filter name=qa-c3-
```

## 5. Refs

- `web/src/pages/ProjectDetail.tsx:221-303` (rollback/blueGreen handlers)
- `src/monitor/recovery-coordinator.ts:300-422`
- BUG-003/004/016
- 핫스팟 #1 (RecoveryCoordinator partial-failure)
