# Day 3 Report — 2026-04-21

## 완료

- ✅ `src/monitor/recovery-policy.ts` 신규 — `checkRecoveryEligibility` + `withRecoveryStage` 단일 정책 모듈
- ✅ `recovery-coordinator.ts` 마이그레이션 — `checkEligibility` + `shouldContinue` 모두 새 함수 사용 (**U-P0-4 잔여 갭 닫힘**)
- ✅ `ops-recovery.ts` 마이그레이션 — bespoke lock 분기 제거, stale 정책 통일
- ✅ `auto-recovery.ts` 마이그레이션 — `findMatchingPatterns`/`saveRecoveryPattern` silent swallow 제거 (**U-P0-9/10 자동 해결**)
- ✅ `events/index.ts` — `recovery:degraded` 이벤트 type 추가
- ✅ `recovery-policy.test.ts` 19개 신규 테스트

## 검증 결과

| 항목                             | 결과                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| 신규 19 테스트 (recovery-policy) | 19/19 PASS                                                                 |
| Day 1-2 회귀 (8개 테스트)        | 8/8 PASS — 동등 동작 보장                                                  |
| Monitor 전체                     | 153/153 PASS (이전 134 → +19)                                              |
| 풀 테스트                        | 2614 PASS, 4 skip (이전 2595 → 회귀 0)                                     |
| typecheck/build                  | 통과                                                                       |
| code-reviewer                    | **APPROVE with follow-ups** (0 Critical / 3 Major / 6 Minor / 8 Validated) |

## 커밋

- `1c36e63` — refactor(monitor): extract RecoveryPolicy as single source of eligibility and stage handling

## Architectural Wins

1. **단일 정책 함수**: 5개 trigger × 7개 invariant 매트릭스가 한 곳에 코드화 + 문서화
2. **U-P0-4 잔여 갭 닫힘**: shouldContinue가 deploy lock 체크 → CCG가 발견한 진짜 갭 해결
3. **U-P0-2 architectural 승격**: `withRecoveryStage` wrapper로 인라인 try/catch 제거, 다음 핸들러 추가 시 같은 실수 재발 방지
4. **U-P0-9/10 자동 해결**: auto-recovery silent swallow도 같은 wrapper로 통일

## Day 4 작업으로 추가된 항목 (code-reviewer Major 3건)

### M1: `recovery:degraded` listener 부재

- 4개 emit point 있지만 listener 0개 → "visibility" 목표 절반만 달성
- **Day 4에 추가**: `incident-reporter`가 구독해서 ops_incident_event row로 persist

### M2: `void withRecoveryStage` fire-and-forget

- `auto-recovery.ts:391`의 `void` 사용이 unhandled rejection 위험
- **Day 4에 추가**: `.catch(() => {})` 명시 또는 helper 옵션

### M3: `checkEligibility` trigger 'container_failure' 고정

- `ingestRuntimeSignal`이 모든 signal kind에 동일 trigger 사용 → 추상화 약화
- **Day 4에 추가**: `signalKindToTrigger(signal.kind)` 매핑 + caller 정확화

## 내일 계획 (Day 4) — RecoveryPolicy 보강 + Day 5 준비

원래 Day 4 작업(RecoveryPolicy 마이그레이션)은 Day 3에 완료됨. Day 4는 follow-up 3건 + Day 5 (withDeployLock) 디자인.

| #   | 작업                                                                     | 추정    |
| --- | ------------------------------------------------------------------------ | ------- |
| 4.1 | M1: `recovery:degraded` listener 추가 (incident-reporter)                | 1.5시간 |
| 4.2 | M2: `void withRecoveryStage` → 명시적 .catch 패턴                        | 30분    |
| 4.3 | M3: signal kind → trigger 매핑 정확화                                    | 1시간   |
| 4.4 | Day 5 디자인: withDeployLock helper + MCP/tools/webhook 경로 eligibility | 1시간   |
| 4.5 | code-reviewer 패스 + commit                                              | 1시간   |

총 추정 5시간. Day 4 EOD = code-reviewer Major 0건 + Day 5 작업 명세 준비.

## 위험 신호

없음. 회귀 0, code-reviewer 합격.

## 본인 결정 필요

없음. Day 4로 그대로 진행 가능.
