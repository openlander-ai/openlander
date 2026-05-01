# Charter C2: ProjectDetail_TIMELINE_RUNTIME

**Tier**: Best-Effort
**예상 소요**: 30분

## 1. Pre-condition

- C1 완료 후 임시 프로젝트 1개 생성: `qa-c2-app` (test-single-dockerfile)
- 또는 C1S3 cleanup 전에 그 프로젝트 재활용 (이 경우 C1과 순차 실행)

## 2. Scenarios

### C2S1_TAB_SWITCH_NO_LEAK

ProjectDetail 진입 → 5탭(Overview/Deployments/Recovery/Runtime/Settings) 전환 5회 왕복.
**PASS**: 각 탭 진입 시 console.error 0건 + 폴링 중복 호출 없음 (DevTools Network 탭 확인).

### C2S2_OVERVIEW_KPI_NONZERO (BUG-017 회귀)

Overview 탭 → CPU/메모리 카드 확인.
**PASS**: 카드에 0이 아닌 실제 수치 노출 (running 프로젝트 기준).
**FAIL**: 모든 값 0 또는 "Cannot read properties of undefined" 표시.

### C2S3_TIMELINE_LIVE_SMOKE

Overview 탭 진입 후 다른 터미널에서 `docker exec qa-c2-app sh -c 'echo test'` (이벤트 발생) → Overview 탭의 timeline 영역 관찰.
**PASS**: 30초 안에 새 이벤트 row 추가 시각적으로 확인 (정확한 ordering은 unit 트랙 검증).

### C2S4_RUNTIME_LOG_STREAM

Runtime 탭 → 로그 스트림 자동 시작 → 다른 터미널에서 `docker exec qa-c2-app sh -c 'echo HELLO_QA'`.
**PASS**: 5초 안에 'HELLO_QA' 라인 표시.
**FAIL**: 라인 미표시 또는 스트림 disconnect 토스트.

### C2S5_TIMELINE_RECONNECT

Runtime 탭 활성 상태에서 PM2 reload (또는 짧은 네트워크 단절) → 재연결.
**PASS**: 재연결 표시 후 새 로그 다시 흐름 + UI 무한 로딩 0회.

## 3. Output

표준 5섹션. 추가:

- DevTools Network 탭의 build/stream NDJSON 요청 수와 reconnect 횟수 기록

## 4. Cleanup

```bash
# UI: Purge qa-c2-app
docker ps -a --filter name=qa-c2-
```

## 5. Refs

- `web/src/hooks/use-timeline.ts:100-219`
- `web/src/hooks/use-log-stream.ts`
- BUG-017
