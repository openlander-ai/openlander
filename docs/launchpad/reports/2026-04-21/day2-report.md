# Day 2 Report — 2026-04-21

## 🟢 Ship-Ready 안전핀 확보 — 6/6 GA Blocker 모두 처리 완료

## 완료

- ✅ U-P0-5: LLM stream cancel을 circuit breaker failure로 기록 (`src/llm/model-registry.ts`)
- ✅ U-P0-7: Deploy-stream 응답에 `statusUrl` 추가 (옵션 B 폴링 채택, `src/web/api/deploy-stream-routes.ts`)
- ✅ U-P0-8: archived/recovering/circuit_open 프로젝트 mutating route 거부 — 새 에러 클래스 3개 + `assertProjectMutable` helper (`src/errors.ts`, `src/web/api/project-routes.ts`)

## 신규 테스트 (17건 모두 PASS)

- `test/llm/model-registry-cancel.test.ts` — 5건 (cancel→failure, success→reset, threshold open, classify reason)
- `test/web/api/deploy-stream-routes-error.test.ts` — 2건 (response shape with statusUrl)
- `test/web/api/project-routes-eligibility.test.ts` — 10건 (3 routes × 3 eligibility error + healthy passthrough)

## 검증 결과

| 항목               | 결과                                      |
| ------------------ | ----------------------------------------- |
| 신규 17 테스트     | 17/17 PASS                                |
| `npm test` 풀      | 2595 PASS, 4 SKIP (1.0.x 백로그) — 회귀 0 |
| `npx tsc --noEmit` | 통과                                      |
| `npm run build`    | 통과 (web 3.48s)                          |
| PM2 reload         | 정상 (UI 200, API 200)                    |

## 커밋

- `4d07c30` — fix(llm): record stream cancellation as failure for circuit breaker
- `aef4b73` — fix(web): expose statusUrl in deploy response so clients can poll
- `13b6c7c` — fix(web): reject mutating routes for archived/recovering/circuit-broken projects
- `cb5a6bb` — docs(launchpad): add 7-day GA fix plan and Day 1 report

## 1.0 GA 게이트 현재 상태

| ID        | 영역                                        | 상태             |
| --------- | ------------------------------------------- | ---------------- |
| ✅ U-P0-1 | compose ResourceLimits UI 비활성            | done (이전 커밋) |
| ✅ U-P0-2 | RecoveryCoordinator partial-failure swallow | done (Day 1)     |
| ✅ U-P0-4 | Deploy lock vs Recovery race                | done (Day 1)     |
| ✅ U-P0-5 | LLM stream cancel circuit breaker           | done (Day 2)     |
| ✅ U-P0-6 | Hono global onError                         | done (Day 1)     |
| ✅ U-P0-7 | deploy-stream silent failure                | done (Day 2)     |
| ✅ U-P0-8 | API mutating route eligibility              | done (Day 2)     |

**🟢 모든 P0 처리 완료. 본인 결정에 따라 즉시 GA 가능 (Minimal Go).**

## 발견 사항

- U-P0-7 fix 진행 중 발견: 기존 `handleTerminalFailure()`가 이미 status='error' + emit deploy:failed 호출 중. 즉 silent failure는 _없었음_ — 단지 client가 `statusUrl` 없어서 어디 polling 할지 모르는 게 문제. fix는 응답 payload 추가만으로 충분.
- U-P0-5 구현 시 TypeScript DOM lib의 `Transformer` 인터페이스에 `cancel` 콜백이 없어서 `TransformStream` 대신 `ReadableStream` 사용. 동작 동일.

## 내일 계획 (Day 3) — RecoveryPolicy 모듈 추출

목표: U-P0-2 인라인 fix를 정식 architectural layer로 승격. U-P0-9/10 자동 해결.

작업:

1. `oh-my-claudecode:plan` (간단 인터뷰) → RecoveryPolicy 디자인 1시간
2. `executor` → `src/monitor/recovery-policy.ts` 신규 모듈 + 단위 테스트 3시간
3. `code-reviewer` 1차 패스 30분
4. 회귀 검증 + commit 30분

총 추정 5시간.

## 위험 신호

없음. Day 1+2 합쳐 7개 commit, 회귀 0, PM2 정상 운영 중.

## 본인 결정 필요

**선택지** (둘 중):

1. **Day 3-7 계획대로 진행** — RecoveryPolicy + withDeployLock 추출 + 정책 명문화 → "진짜 1.0" 릴리스
2. **즉시 GA** — 6 P0 다 fix됐으니 지금 release-it으로 1.0.0 릴리스 가능. Day 3-7 작업은 1.0.1 마일스톤으로

본인 컨디션/일정 따라 선택. 권장은 Day 3 계속 (1주 일정 절반 지남, 이미 안전핀 확보).
