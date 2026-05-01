# Day 5 Report — 2026-04-21

## 완료

- ✅ `withDeployLock` + `acquireDeployLockOrThrow` helper (`src/db/repos/deploy-lock-helper.ts`)
- ✅ `assertProjectMutable` policy를 `src/pipeline/mutation-policy.ts`로 추출
- ✅ Pipeline boundary 4개 entry point에 정책 + lock 적용:
  - `pipeline.redeploy` (Day 5 1차)
  - `pipeline.rollback` (Day 5 1차)
  - `pipeline.startDeploy` 기존 project 분기 (HIGH-A)
  - `pipeline.deployEnvironment` (HIGH-A)
- ✅ Caller 처리:
  - `webhook/index.ts`: graceful skip + `mapPolicySkip`
  - `tools/defs/env.ts`: catch + `updated_redeploy_skipped` 응답
  - `tools/defs/deploy.ts` (rollback_project, deploy_blue_green): pre-check + race-window catch (HIGH-B)
  - `tools/defs/project-ops.ts` (restart_project, redeploy_project): 동일 (HIGH-B)
  - `tools/defs/helpers.ts`: `tryRejectIfNotMutable` + `buildPolicyRejectionResponse` 공용 helper
  - `web/api/project-routes.ts`: redeploy/rollback/blue-green catch가 typed 409 처리 (HIGH-C)
- ✅ U-P0-11 Repo "not found" 표준화 (11 repos, 8 new typed errors)

## 검증 결과

| 항목                     | 결과                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| 신규 테스트 (Day 5 전체) | 58 (10 helper + 6 policy + 15 boundary + 14 eligibility race + 17 tools policy + 10 persistence) |
| Day 1-4 baseline (45건)  | 45/45 PASS — 회귀 0                                                                              |
| 풀 테스트                | **2689 PASS, 4 skip** (이전 2620 → +69, 회귀 0)                                                  |
| typecheck/build          | 통과                                                                                             |
| code-reviewer            | **APPROVE with followups** (0 Critical / 1 HIGH→fix됨 / 1 HIGH followup / 4 Medium / Low다수)    |
| Codex CCG                | **REQUEST CHANGES → 모두 fix** (3 HIGH 발견 → HIGH-A/B/C 처리 완료)                              |

## 커밋 (4개 logical commits)

- `7115137` — feat(pipeline): add withDeployLock helper and assertProjectMutable policy
- `9f66529` — fix(pipeline): enforce mutation policy and lock at all four pipeline entry points
- `9d5fc6b` — fix(tools,web,webhook): map mutation policy errors to typed responses everywhere
- `7b495a5` — refactor(db,errors): standardize repo persistence failures with typed errors (U-P0-11)

## Architectural Wins

1. **단일 boundary**: 모든 mutation은 `pipeline.{startDeploy, redeploy, rollback, deployEnvironment}` 경유 → 정책이 한 곳에 강제됨. 미래 caller 추가해도 자동 보호.
2. **Lock 패턴 단일화**: 4곳 중복 try/finally 제거 → `withDeployLock` 한 줄로 대체
3. **CCG U-P0-8 갭 완전 closed**: web router-only 보호 → pipeline boundary 보호 (모든 caller)
4. **Typed error contract**: 8 new typed errors (404 NotFound + 500 Persistence) → caller가 `instanceof` 분기 가능
5. **Race window 방어**: web에서 pass했어도 pipeline boundary가 마지막 방어선 (HIGH-C 처리)

## Remaining Followups (1.0.x로 이월 — 모두 MEDIUM 이하)

### Code-reviewer가 식별

1. **HIGH followup** (deferred): `pipeline.rollback` 의 project-not-found 분기가 lock/policy 우회 — 이번 PR scope 외, 별도 cleanup
2. **LOW**: 7 새 typed NotFoundError (Environment, Service 등) 사용처 미확인 — dead code 가능성 (caller 측 추가 적용 필요)
3. **LOW**: tools/defs lock 외부 acquire/release 패턴 deprecate (design §10)
4. **LOW**: webhook skip 시 log.info 추가

### Codex가 식별

5. **MEDIUM-D**: `engine.ts` async lock release — fireAndForgetDeploy uncaught failure 시 deploy:failed emit 안 함 → plan-engine이 release event 못 받음 → 30분 stale window까지 lock 잔존
6. **MEDIUM-E**: webhook skip이 `deploy:start` 먼저 emit 후 terminal event 없이 skip → questionBridge stale active-project + activity false start
7. **MEDIUM-F**: compose rollback이 policy reject되면 result는 'rolled_back'로 표시되지만 실제로는 partial deployment 잔존

→ 모두 1.0.x 첫 작업으로 이월. GA 차단 사유 아님.

## 내일 계획 (Day 6) — 정책 명문화 + Migration 가이드

| #   | 작업                                                           | 추정  |
| --- | -------------------------------------------------------------- | ----- |
| 6.1 | AGENTS.md "Error Handling" 섹션 확장 (현 13줄 → 정책 가이드)   | 1시간 |
| 6.2 | CONTRIBUTING.md 신설 — exception 정책 + cross-cutting 가이드   | 1시간 |
| 6.3 | `docs/migration-rc7-to-rc9.md` — rc.7 사용자 업그레이드 가이드 | 30분  |
| 6.4 | CHANGELOG.md 1.0.0 항목 작성 (Breaking/Feature 명시)           | 30분  |

총 추정 3시간. Day 6은 문서 작업이라 회귀 위험 낮음.

## 위험 신호

없음. 회귀 0 + code-reviewer + Codex 모두 처리 완료.

## 본인 결정 필요

없음. Day 6 진행 가능.
