# OpenLander 1.0.0 GA Fix Plan — 7-Day Roadmap

**작성일**: 2026-04-20
**대상 버전**: 1.0.0 (현재 1.0.0-rc.9, develop ↔ main 머지 완료)
**근거 문서**: `qa-webui-plan-v2-2026-04-20.md`, `qa-unit-test-track-2026-04-20.md`, 4-agent audit (Pipeline / Monitor+Web / DB+LLM / Architect)
**작성 방식**: critic + Codex + Gemini 3모델 리뷰 → 4-agent 전수조사 → 본 플랜으로 종합

---

## 0. Mission

GA blocker 6건을 안전하게 fix + 재발 방지를 위한 architectural layer 추출. **Day 2 EOD = ship-ready** 안전핀 유지하여 본인 컨디션/일정 변동 시 조기 ship 옵션 보존.

## 1. GA Blocker 인벤토리 (재확정)

| ID            | 영역                                                           | 발견 경로                      | 검증 상태         | Day  |
| ------------- | -------------------------------------------------------------- | ------------------------------ | ----------------- | ---- |
| ✅ ~~U-P0-1~~ | compose ResourceLimits UI 비활성                               | 이전 작업                      | 커밋 `6efbfe9`    | done |
| 🔴 U-P0-2     | RecoveryCoordinator partial-failure swallow                    | Codex hotspot + unit test 재현 | test FAIL 재현 ✅ | 1    |
| 🔴 U-P0-4     | Deploy lock vs Recovery race                                   | Codex hotspot + unit test 재현 | test FAIL 재현 ✅ | 1    |
| 🔴 U-P0-5     | LLM stream cancel → success로 카운트 (`model-registry.ts:216`) | DB/LLM audit                   | 코드 직접 확인    | 2    |
| 🔴 U-P0-6     | Hono `app.onError` 글로벌 핸들러 부재                          | Monitor+Web audit              | 코드 직접 확인    | 1    |
| 🔴 U-P0-7     | `deploy-stream-routes.ts:177-248` Detached IIFE silent failure | Monitor+Web audit              | 코드 직접 확인    | 2    |
| 🔴 U-P0-8     | API redeploy/rollback에 archived/circuit_breaker 체크 없음     | Monitor+Web audit              | 코드 직접 확인    | 2    |

## 2. 1.0.x 백로그 (GA 후 패치)

| ID         | 발견                                                  | 영향                                                   | 처리                                     |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| 🟡 U-P0-9  | auto-recovery `findMatchingPatterns()` silent swallow | 학습 효과 저하 (사용자 visible 0)                      | RecoveryPolicy 추출 시 자동 해결 (Day 3) |
| 🟡 U-P0-10 | auto-recovery `saveRecoveryPattern()` silent swallow  | 동일                                                   | RecoveryPolicy 추출 시 자동 해결 (Day 3) |
| 🟡 U-P0-11 | Repo "not found" 처리 불일치 (8개 repo)               | 디자인 부채                                            | Day 5 표준화 (withDeployLock과 묶음)     |
| 🟡 U-P0-12 | Migration 트랜잭션 silent rollback                    | MIG fresh boot은 PASS, rc.7 업그레이드는 가이드로 대응 | Day 6 release notes에 백업 권고          |

## 3. v1.1+ 아키텍처 트랙 (1.0 후)

- 에러 hierarchy에 Transient/Permanent marker interface
- AsyncLocalStorage 기반 correlation context
- Decorator-style cross-cutting (`@retryable`, `@circuit-breaker`)
- 풀 에러 정책 가이드 (CONTRIBUTING.md 신설 섹션)

---

## 4. Day-by-Day 로드맵

### Day 1 (오늘) — Critical safety net

**목표**: 가장 단순/위험낮은 fix 3건. EOD에 unit test 모두 PASS.

| #   | 작업                                              | 추정    | 도구               | 검증                                                                 |
| --- | ------------------------------------------------- | ------- | ------------------ | -------------------------------------------------------------------- |
| 1.1 | U-P0-6 Hono `app.onError` 글로벌 핸들러           | 30분    | 직접 (단순)        | curl로 unhandled error 테스트 → 500 + 정형 JSON                      |
| 1.2 | U-P0-2 fix (recovery-coordinator stage emit 정책) | 1.5시간 | `ralph`            | `test/monitor/recovery-coordinator-partial-failure.test.ts` 4/4 PASS |
| 1.3 | U-P0-4 fix (deploy lock 체크 추가)                | 1.5시간 | `ralph`            | `test/monitor/recovery-coordinator-deploy-lock.test.ts` 4/4 PASS     |
| 1.4 | Day 1 회귀 검증                                   | 30분    | `npm test` 풀 실행 | 기존 202 테스트 유지                                                 |
| 1.5 | Day 1 commit + 본인 보고                          | 15분    | 직접               | 3개 commit (P0별 분리)                                               |

**Day 1 EOD 상태**: P0 3/6 처리. 안전망 확보.

---

### Day 2 — Ship-ready

**목표**: 나머지 P0 3건 fix. **EOD = 6 P0 다 처리 → ship 가능**.

| #   | 작업                                                | 추정  | 도구                                                             | 검증                              |
| --- | --------------------------------------------------- | ----- | ---------------------------------------------------------------- | --------------------------------- |
| 2.1 | U-P0-5 fix (LLM circuit breaker cancel handler)     | 1시간 | `ralph` + 신규 unit test                                         | cancel 시 recordFailure 호출 확인 |
| 2.2 | U-P0-7 fix (deploy-stream IIFE → 정형 에러 처리)    | 2시간 | `executor` (변경 surface 큼) + `code-reviewer`                   | client에 명확한 status 노출       |
| 2.3 | U-P0-8 fix (API redeploy/rollback eligibility 체크) | 1시간 | `ralph` + 신규 unit test                                         | archived 프로젝트 redeploy → 409  |
| 2.4 | Day 2 통합 회귀                                     | 30분  | `npm test` + `npm run test:e2e --project=quality-gate` 일부 spec | 전체 기존 테스트 유지             |
| 2.5 | Day 2 commit + 본인 보고                            | 15분  | 직접                                                             | 3 commits                         |

**Day 2 EOD 상태**: 🟢 **Ship-ready**. 본인 결정으로 GA 진행 가능.

---

### Day 3-4 — RecoveryPolicy 모듈 추출 (architectural)

**목표**: U-P0-2 인라인 fix를 정식 architectural layer로 승격. U-P0-9/10 자동 해결.

#### Day 3

| #   | 작업                                                                | 추정  | 도구                                     |
| --- | ------------------------------------------------------------------- | ----- | ---------------------------------------- |
| 3.1 | RecoveryPolicy 디자인 문서 (`docs/architecture/recovery-policy.md`) | 1시간 | `oh-my-claudecode:plan` (interview 짧게) |
| 3.2 | `src/monitor/recovery-policy.ts` 신규 모듈 구현 + 단위 테스트       | 3시간 | `executor`                               |
| 3.3 | `code-reviewer` 1차 패스                                            | 30분  | `oh-my-claudecode:code-reviewer`         |
| 3.4 | 회귀 검증 + commit                                                  | 30분  | 직접                                     |

#### Day 4

| #   | 작업                                                                                  | 추정  | 도구                             |
| --- | ------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| 4.1 | `recovery-coordinator.ts`의 stage A/C/D를 `withRecoveryStage` wrapper로 마이그레이션  | 2시간 | `executor`                       |
| 4.2 | `auto-recovery.ts`의 U-P0-9/10 swallow도 같은 wrapper로 마이그레이션                  | 1시간 | `executor`                       |
| 4.3 | Day 1 fix를 wrapper 사용으로 단순화 (인라인 → 1줄 호출)                               | 1시간 | `executor`                       |
| 4.4 | 신규 unit test: `recovery-policy.test.ts` (wrapper 자체 테스트) + Day 1 테스트 재실행 | 1시간 | 직접                             |
| 4.5 | `code-reviewer` 2차 + commit                                                          | 30분  | `oh-my-claudecode:code-reviewer` |

**Day 4 EOD 상태**: partial-failure 자동 emit + 검출 가능. recovery 코드 가독성 향상.

---

### Day 5 — withDeployLock helper + Repo 표준화

**목표**: Day 1 U-P0-4 fix를 정식 helper로 승격. Deploy lock invariant를 type으로 강제. U-P0-11 repo 표준화.

| #   | 작업                                                       | 추정    | 도구                                        |
| --- | ---------------------------------------------------------- | ------- | ------------------------------------------- |
| 5.1 | `src/db/repos/deploy-lock-helper.ts` 디자인 + 구현         | 2시간   | `oh-my-claudecode:plan` (간단) → `executor` |
| 5.2 | `deploy-core.ts`, `plan-engine.ts` 4곳 마이그레이션        | 1.5시간 | `executor`                                  |
| 5.3 | `ops-recovery.ts`의 read-only check를 helper 사용으로 통합 | 1시간   | `executor`                                  |
| 5.4 | U-P0-11 repo "not found" 표준화 (8 repo 동일 패턴 적용)    | 2시간   | `executor`                                  |
| 5.5 | 통합 회귀 + commit                                         | 30분    | 직접                                        |

**Day 5 EOD 상태**: lock invariant + repo error contract 일관화.

---

### Day 6 — 명문화 + Migration 가이드

**목표**: 다음 PR부터 같은 패턴 안 생기게 정책 문서화. rc.7 업그레이드 가이드.

| #   | 작업                                                                                                                 | 추정  | 도구                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------- |
| 6.1 | AGENTS.md "Error Handling" 섹션 확장 (현 13줄 → 본격 가이드)                                                         | 1시간 | `oh-my-claudecode:writer` (haiku) |
| 6.2 | CONTRIBUTING.md 신설 — exception 정책 + cross-cutting 가이드                                                         | 1시간 | `writer`                          |
| 6.3 | `docs/migration-rc7-to-rc9.md` — rc.7 사용자 업그레이드 가이드 (백업 권고 + `SELECT DISTINCT result` 사전 체크 포함) | 30분  | `writer`                          |
| 6.4 | (옵션) MIG2 실행 — 본인이 rc.7 스냅샷 보유 시                                                                        | 30분  | 직접                              |
| 6.5 | CHANGELOG.md 1.0.0 항목 작성                                                                                         | 30분  | 직접                              |

**Day 6 EOD 상태**: 정책 문서화 완료. 다음 contributor가 같은 실수 안 함.

---

### Day 7 — Final verification + GA

**목표**: 독립 검증 패스 + GA 게이트 통과 + release.

| #   | 작업                                                         | 추정  | 도구                       |
| --- | ------------------------------------------------------------ | ----- | -------------------------- |
| 7.1 | `oh-my-claudecode:verifier` 풀 패스                          | 1시간 | OMC verifier               |
| 7.2 | UI QA 차터 1라운드 (C1, C3, C4, C5, C6 — Zero-Tolerance 5개) | 3시간 | Playwright MCP + qa-tester |
| 7.3 | 최종 GA 게이트 체크리스트 (§6)                               | 30분  | 직접                       |
| 7.4 | `npm run release` (release-it 사용, CHANGELOG 자동 반영)     | 30분  | 직접                       |
| 7.5 | GitHub Release + 트위터/블로그 announcement (선택)           | 1시간 | 직접                       |

**Day 7 EOD**: 🚀 **OpenLander 1.0.0 GA**.

---

## 5. P0별 Fix 상세

### U-P0-2 — RecoveryCoordinator partial-failure 가시화

**파일**: `src/monitor/recovery-coordinator.ts`
**현재 (버그)**: `:300-422` 근방 stage A/B/C/D 각각 try/catch + warn → 후속 stage 진행
**Day 1 quick fix**: stage C(transition) 실패 시 `recovery:degraded` 이벤트 emit 후 stage D skip

```ts
try {
  await transitionProjectStatus(...)
} catch (err) {
  events.emit('recovery:degraded', { stage: 'C', projectId, reason: err.message })
  return  // stage D 진행 차단
}
```

**Day 4 architectural fix**: `withRecoveryStage('C', ctx, () => transitionProjectStatus(...))` 한 줄로 대체
**검증**: `test/monitor/recovery-coordinator-partial-failure.test.ts` 4/4 PASS
**Rollback**: 단일 함수 수정이라 git revert 가능

### U-P0-4 — Deploy lock vs Recovery race

**파일**: `src/monitor/recovery-coordinator.ts` `checkEligibility` 또는 동등 위치
**Day 1 quick fix**: eligibility gate에 deploy lock 체크 추가

```ts
const project = db.getProject(projectId);
if (project.deploy_lock_session && isLockFresh(project.deploy_lock_at)) {
  events.emit('recovery:blocked', { reason: 'deploy_in_progress', projectId });
  return false;
}
```

- `handleContainerFailure`, `handleHealthDegraded`, `handleDeployFailed` 셋 다 적용
  **Day 5 architectural fix**: `withDeployLock` helper의 일부로 통합
  **검증**: `test/monitor/recovery-coordinator-deploy-lock.test.ts` 4/4 PASS
  **Rollback**: gate 함수 수정만, 단순

### U-P0-5 — LLM circuit breaker cancel handler

**파일**: `src/llm/model-registry.ts:215-220`
**현재**: TransformStream에 `flush()` 만 (success 가정), `cancel()` 없음
**Fix**:

```ts
new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk);
  },
  flush() {
    circuitBreaker.recordSuccess();
  },
  cancel(reason) {
    circuitBreaker.recordFailure({ reason: 'cancelled', detail: String(reason) });
  },
});
```

**검증**: 신규 `test/llm/model-registry-cancel.test.ts` — abort signal 발사 후 recordFailure 호출 확인
**Rollback**: 단일 위치, 안전

### U-P0-6 — Hono 글로벌 onError

**파일**: `src/web/server.ts` `createApp` 함수 시작 부근
**Fix**:

```ts
app.onError((err, c) => {
  log.error({ err, path: c.req.path }, 'Unhandled route error');
  if (err instanceof OpenLanderError) {
    return c.json(err.toJSON(), err.statusCode);
  }
  return c.json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }, 500);
});
```

**위치**: `app` 생성 직후, route mount 전
**검증**:

- `curl http://localhost:10114/api/some-throwing-route` → 500 + 정형 JSON
- 기존 onError가 있는 createApiRoutes는 그대로 동작 (sub-app 우선순위)
  **Rollback**: 1줄 함수 추가, 안전

### U-P0-7 — Deploy-stream detached IIFE

**파일**: `src/web/api/deploy-stream-routes.ts:177-248`
**현재**: route handler가 200 반환 후 `void (async () => {...})()` 비동기 deploy 진행. 실패해도 client는 모름.
**Fix 옵션**:

- **A (권장, 호환성 ↑)**: 응답을 NDJSON 스트림으로 변경. 첫 줄 `{type:'started',deployId}` → 진행/실패도 같은 스트림으로 전달
- **B (간단)**: 응답에 deployId만 반환 + client가 `/projects/:id` 폴링. detached promise 유지하되 실패 시 DB status='error' 명확히 기록
- **추천**: **B** — 변경 surface 작음, 1.0 GA 직전 안전

**Fix 상세 (옵션 B)**:

```ts
// 응답: { deployId, projectId, statusUrl: '/api/projects/:id' }
// detached IIFE 내부 try/catch에서 catch 시:
//   - DB project.status = 'error' 강제
//   - eventBus emit 'deploy:failed' (이미 있을 가능성 큼)
//   - 명확한 error_message DB에 저장
```

**검증**:

- 신규 test: 강제 deploy 실패 → DB status='error' + 클라이언트 폴링으로 확인 가능
- e2e: deploy 시작 → 강제 실패 → UI에서 명확한 에러 표시
  **Rollback**: detached IIFE catch 블록 보강이라 단순

### U-P0-8 — API redeploy/rollback eligibility

**파일**: `src/web/api/project-routes.ts:705-748` (redeploy), 동일 파일의 rollback 라우트, blue-green 라우트
**Fix**: 진입 직후 eligibility 체크 함수 호출

```ts
function assertProjectMutable(project: Project) {
  if (project.archived_at) throw new ProjectArchivedError(project.id);
  if (db.isCircuitBreakerOpen(project.id)) throw new CircuitBreakerOpenError(project.id);
  if (project.status === 'recovering') throw new ProjectRecoveringError(project.id);
}
```

- `redeploy`, `rollback`, `blueGreen`, `start`, `stop` route 시작에서 호출
- `src/errors.ts`에 신규 에러 클래스 3개 추가 (statusCode: 409)
  **검증**:
- 신규 test: archived 프로젝트 → POST /redeploy → 409
- 기존 quality-gate spec 영향 없는지 확인
  **Rollback**: 라우트별 1줄 추가, 단순

---

## 6. GA 게이트 체크리스트 (Day 7)

### Must (모두 통과해야 GA)

- [ ] U-P0-2 fix → `recovery-coordinator-partial-failure.test.ts` 4/4 PASS
- [ ] U-P0-4 fix → `recovery-coordinator-deploy-lock.test.ts` 4/4 PASS
- [ ] U-P0-5 fix → `model-registry-cancel.test.ts` (신규) PASS
- [ ] U-P0-6 fix → `app.onError` 동작 curl 검증
- [ ] U-P0-7 fix → deploy 실패 시 client에 명확한 status 노출
- [ ] U-P0-8 fix → archived/circuit_open 프로젝트 mutating route 거부
- [ ] `npm test` 전체 PASS (기존 202+ 테스트 유지)
- [ ] `npm run lint` PASS
- [ ] `npm run typecheck` PASS
- [ ] UI Zero-Tolerance 차터 5개 PASS (C1, C3, C4, C5, C6)
- [ ] `oh-my-claudecode:verifier` 독립 검증 PASS
- [ ] CHANGELOG.md 1.0.0 항목 정확
- [ ] release notes 작성

### Should (가능하면)

- [ ] RecoveryPolicy 모듈 추출 + 마이그레이션 완료
- [ ] withDeployLock helper + 4곳 마이그레이션
- [ ] AGENTS.md/CONTRIBUTING.md 정책 명문화
- [ ] MIG2 (rc.7 업그레이드) 검증 (스냅샷 보유 시)

### No-Go (즉시 차단)

- 기존 test 회귀 발생 (수가 줄거나 새로 fail)
- recovery loop 무한 LLM 호출 (비용 폭증)
- 데이터 손상 (Purge, Migration 영향)
- 보안 회귀 (미인증 보호 라우트 진입)

---

## 7. 일일 보고 형식

각 day EOD에 본인에게 보고할 표준 형식:

```markdown
## Day N Report — YYYY-MM-DD

**완료**: ...
**검증 결과**: 테스트 N개 PASS / 회귀 0건
**커밋**: hash1, hash2, hash3
**발견 사항**: 예상 못한 ... (있다면)
**내일 계획**: Day N+1 작업 항목
**위험 신호**: ... (있다면)
**본인 결정 필요**: ... (있다면)
```

---

## 8. 위험 + 완화

| 위험                                                   | 가능성 | 영향          | 완화                                                                                                        |
| ------------------------------------------------------ | ------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| Day 1-2 fix가 기존 테스트 회귀                         | 중     | 높음          | 매 fix마다 `npm test` 풀 실행 강제. 1건이라도 회귀 시 즉시 rollback + 분석                                  |
| Day 3-4 RecoveryPolicy 추출이 production behavior 변화 | 중     | 매우 높음     | code-reviewer 2회 통과 + Day 1 fix 테스트 재실행 + e2e quality-gate 일부 spec 실행                          |
| Day 5 withDeployLock이 deploy hot path 영향            | 중     | 매우 높음     | helper 추가 → 4곳 점진 마이그레이션 (한 곳씩 commit) → 각 commit마다 deploy 시나리오 수동 검증              |
| Day 7 GA 게이트에서 critical 발견                      | 낮음   | 중 (1주 연기) | 일정 buffer 없음 → 발견 시 GA 1주 추가 연기 + 본인 OK 받음                                                  |
| 본인 burnout (백수 + 1주 풀가동)                       | 중     | 높음          | 하루 4~6시간 권장. Day 2 EOD 안전핀이라 그 후 페이스 조절 가능. 무리하면 페어 작업 (저는 작업, 본인 검토만) |
| MIG2 (rc.7) 미검증                                     | 중     | 중            | Day 6에 명확한 업그레이드 가이드 + 백업 권고로 대응. 기술적 검증은 v1.0.1에서                               |

---

## 9. OMC 도구 사용 의도

| 도구                             | 사용 목적                                                 | 한계                                |
| -------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `ralph`                          | 단일 P0 fix (verifier=specific test passes). Day 1-2 핵심 | 큰 architectural 변경엔 부적합      |
| `oh-my-claudecode:plan`          | RecoveryPolicy/withDeployLock 디자인 단계                 | 인터뷰가 길어질 수 있음 — 짧게 명시 |
| `oh-my-claudecode:executor`      | 구현 작업 (sonnet 기본, 복잡한 건 opus)                   | 단일 패스, review 없음              |
| `oh-my-claudecode:code-reviewer` | 큰 변경 후 리뷰                                           | 별도 컨텍스트라 신선한 시각         |
| `oh-my-claudecode:writer`        | Day 6 문서 작성                                           | haiku 빠름                          |
| `oh-my-claudecode:verifier`      | Day 7 최종 검증                                           | independent 검증 필수               |
| `oh-my-claudecode:autopilot`     | **사용 안 함**                                            | 7일 자율 루프는 통제 어려움         |
| `oh-my-claudecode:team`          | **사용 안 함**                                            | 동시 변경은 conflict 위험           |

---

## 10. 시작 전 본인 확인

이 플랜으로 진행할지 본인 사인오프 필요. 변경/조정할 부분:

- [ ] Day 일정 OK?
- [ ] U-P0-7 fix 옵션 (A NDJSON 스트림 vs B 폴링) — 권장 B 동의?
- [ ] Day 6 MIG2 실행 시 rc.7 스냅샷 보유? (없으면 SKIP)
- [ ] Day 7 release notes에 포함할 highlight 항목?
- [ ] burnout 방지: 하루 작업 시간 합의 (4~6시간 추천)

확인 후 Day 1 작업 시작 합니다.
