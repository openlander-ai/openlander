# Charter C5: OpsCenter_AND_ALERTS

**Tier**: Zero-Tolerance
**예상 소요**: 60분

## 1. Pre-condition

- 임시 프로젝트 1개: `qa-c5-crash` (test-runtime-crash, running)
- 위 프로젝트로 1회 자동 recovery 사이클 발생시킬 예정 (의도적 crash)
- LLM 등록됨

## 2. Scenarios

### C5S1_OPS_TABS_RENDER

/operations → 6탭 (Live/Incidents/Approvals/Postmortems/Patterns/Usage) 전환.
**PASS**: 각 탭 console.error 0건 + 비예상 4xx/5xx 0건.

### C5S2_KEYBOARD_SHORTCUTS

Live 탭에서 j (next), k (prev), / (focus search), ? (help), Esc (close detail).
**PASS**: 모든 단축키 정상 동작.

### C5S3_ACTIVITY_SSE_BACKFILL_LIVE

페이지 로드 → 'backfill-complete' 도달까지 모니터 (DevTools Network).
**PASS**: backfill 완료 후 live 모드 전환, 중복 row 0개.
**Note**: ordering 정확성은 unit 트랙으로 검증.

### C5S4_INCIDENT_FROM_CRASH (R1, BUG-013/014 회귀)

다른 터미널: `docker kill qa-c5-crash` → OpsCenter Live + Incidents 탭 모니터.
**PASS**: 70초 안에 (a) Live feed에 `container:die` 이벤트, (b) Incidents 탭에 새 incident 행, (c) ProjectDetail Operations 탭에서 같은 incident.
**FAIL**: 셋 중 하나라도 누락 또는 카운트 불일치.

### C5S5_INCIDENT_SLIDEOVER

C5S4의 새 incident 클릭 → IncidentDetailSlideover 열림 → 이벤트 타임라인 표시 → Esc로 닫힘.
**PASS**: slideover에 이벤트 시퀀스 정확 + Esc 닫힘 동작.

### C5S6_CIRCUIT_BREAKER_OPEN_RESET (O2)

연속 실패 시뮬레이션 (Settings에서 `qa-c5-crash` automation 강제 enable + crash 5회 반복) → CircuitBreakerWidget에 'open' 표시.
Reset 클릭 → ConfirmDialog → Confirm.
**PASS**: 5회 실패 후 open 표시. Reset 후 closed 상태 즉시 반영.

### C5S7_POSTMORTEM_AUTO_GEN (O3)

C5S4 후 5분 안정성 창 대기 → Postmortems 탭에 새 postmortem 카드 등장.
**PASS**: 5~10분 안에 postmortem 1건 생성 + 클릭 시 LLM 분석 텍스트 노출.
**Note**: LLM 비용 발생, 본인 키 잔액 확인 필요.

## 3. Output

표준 5섹션 + 특별 항목:

- C5S4의 incident count 비교: OpsCenter Incidents 탭 N vs ProjectDetail Operations N (같아야 함)
- C5S6의 circuit breaker open/closed 전이 시간 기록
- LLM 호출 횟수와 토큰 사용량 (Settings/AI 탭에서 확인)

## 4. Cleanup

```bash
# UI: Purge qa-c5-crash
# Settings에서 강제 automation 원래 값으로
```

## 5. Refs

- `web/src/pages/OpsCenterV2.tsx`
- `web/src/hooks/use-ops-center-data.ts`
- `src/web/api/ops-routes.ts`
- BUG-013/014
- 핫스팟 #7 (AI usage abort tracking)
