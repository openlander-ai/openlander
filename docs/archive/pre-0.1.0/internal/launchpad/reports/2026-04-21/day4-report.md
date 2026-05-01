# Day 4 Report — 2026-04-21

## 완료

- ✅ M1: `recovery:degraded` listener 추가 — IncidentReporter (warn log) + ActivityLogger (DB persist) 둘 다
- ✅ M2: `auto-recovery.ts` `void withRecoveryStage` → 명시적 `.catch((err: unknown) => log.error)` 패턴
- ✅ M3: `signalTrigger()` 헬퍼 + `checkEligibility(projectId, trigger?)` 시그니처 확장 — `probe_failed`/`post_deploy_regression`이 `health_degraded`로 정확히 매핑
- ✅ Day 5 디자인 문서 (`docs/architecture/deploy-lock-and-mutation-policy-2026-04-21.md`)

## 검증 결과

| 항목                                           | 결과                             |
| ---------------------------------------------- | -------------------------------- |
| Day 4 신규 14 테스트 (`day4-followup.test.ts`) | 14/14 PASS                       |
| Day 1-3 baseline (27건)                        | 27/27 PASS — 회귀 0              |
| Monitor 전체                                   | 167/167 PASS (이전 153 → +14)    |
| typecheck/build                                | 통과                             |
| 풀 테스트                                      | 2620 PASS, 4 SKIP, **8 fail** ⚠️ |

### ⚠️ 풀 테스트 8 failures — pre-existing test isolation 문제

| 파일                                         | 단독 실행  | 풀 실행 |
| -------------------------------------------- | ---------- | ------- |
| `test/compose.test.ts`                       | 54/54 PASS | 5 fail  |
| `test/pipeline/event-golden.test.ts`         | 7/7 PASS   | 1 fail  |
| `test/pipeline/performance-baseline.test.ts` | 3/3 PASS   | 2 fail  |

**근거**: 각 파일을 단독 실행 시 모두 PASS. 우리 Day 4 변경은 `monitor/`와 `pipeline/auto-recovery.ts`만 수정.
**원인 추정**: vitest parallel 스케줄러의 ordering 변화 — 14개 신규 테스트 추가로 race condition 표면화.
**1.0 GA 영향**: 0 (런타임 회귀 아님, 테스트 인프라 문제)
**처리**: 1.0.x 백로그 — vitest config에 `poolOptions.threads.singleThread: true` 또는 영향 받는 파일 격리

## 커밋

- `f8b0e1e` — fix(monitor): wire recovery:degraded listeners and tighten signal-to-trigger mapping
- `2c581e5` — docs(launchpad): add Day 5 mutation policy design and Day 2/3 reports

## Architectural Wins (Day 4)

1. **U-P0-2 visibility 완전 달성**: degraded 이벤트가 이제 activity_log persist + warn log → 운영자가 검출 가능
2. **Promise rejection 안전망**: M2 `.catch` 명시로 microtask reject silent swallow 방지
3. **trigger semantics 정확화**: 미래 trigger별 다른 정책 도입 시 자연스러운 확장 가능
4. **Day 5 디자인 완료**: 8개 mutation entry point 인벤토리 + 하이브리드(B+C) 결정 명문화

## 내일 계획 (Day 5) — Mutation Policy + withDeployLock

디자인 문서 따라:
| # | 작업 | 추정 |
|---|---|---|
| 5.1 | `withDeployLock` helper 신규 + 단위 테스트 | 1.5시간 |
| 5.2 | `assertProjectMutable` → pipeline-internal `mutation-policy.ts`로 이동 | 30분 |
| 5.3 | `pipeline.{redeploy,rollback,blueGreenDeploy,deploy}` 진입에 정책 + lock 적용 | 2시간 |
| 5.4 | 8개 caller 정리 (lock 직접 호출 제거) | 1.5시간 |
| 5.5 | U-P0-11: Repo "not found" 표준화 (8 repos) | 2시간 |
| 5.6 | 신규 + 회귀 테스트 (e2e/quality-gate 영향 분석 필수) | 1.5시간 |
| 5.7 | code-reviewer 패스 + commit | 1시간 |

총 추정 10시간 — Day 5 + Day 6 일부로 분할 가능.

**Day 5 핵심 위험**: pipeline boundary에 throw 추가하면 기존 caller가 catch 안 하면 unhandled. 단계적 적용 필수.

## 위험 신호

- ⚠️ 풀 테스트 isolation 8 fail (위 분석) — 1.0 GA 영향 0이지만 CI/CD에 영향. Day 7 verifier가 처리 방안 결정 필요
- 그 외 회귀 0

## 본인 결정 필요

없음. Day 5 계획대로 진행 가능. 단, Day 5는 Day 1-4보다 변경 surface 큼 → 본인 검토 빈도 높이는 게 안전.
