# Deploy Lock + Mutation Policy — Day 5 Design

**작성일**: 2026-04-21
**대상**: 1.0.0 GA Day 5 작업
**상위 문서**: `docs/launchpad/qa-1.0-ga-fix-plan-2026-04-20.md`
**목적**: Day 1-2 U-P0-8 fix가 web router에만 적용됐던 갭 해결. 모든 mutation 진입점에서 동일 invariant 보장.

---

## 1. 배경

Day 1-2: `src/web/api/project-routes.ts`의 redeploy/rollback/blue-green에 `assertProjectMutable` 추가 (commit `13b6c7c`).
CCG Codex 발견: 같은 mutation은 다른 7개 진입점에서 우회 가능:

- `src/tools/defs/project-ops.ts` (MCP redeploy/rollback)
- `src/tools/defs/deploy.ts` (MCP deploy)
- `src/tools/defs/env.ts:80` (env 변경 후 자동 redeploy)
- `src/webhook/index.ts:174` (webhook 트리거 redeploy)
- `src/web/api/domain-routes.ts:328` (도메인 변경 후 redeploy)
- `src/tools/defs/compose.ts:242` (compose rollback)

**진짜 fix는 mutation boundary(`pipeline.*`)에 정책 적용** — 이게 Day 5 작업.

---

## 2. 현재 상태 인벤토리

### Deploy Lock 호출 지점 (이미 lock 사용)

| 파일                                     | acquire        | release              | 비고             |
| ---------------------------------------- | -------------- | -------------------- | ---------------- |
| `src/pipeline/deploy-core.ts:1342-1432`  | ✅             | ✅ (finally)         | main deploy      |
| `src/pipeline/deploy-core.ts:1840-1849`  | ✅             | ✅                   | redeploy variant |
| `src/pipeline/deploy-plan/engine.ts:800` | ✅             | ✅ (790에서 release) | plan engine      |
| `src/tools/defs/helpers.ts:39`           | ✅ helper      | tool에서 호출        | MCP path         |
| `src/tools/defs/deploy.ts:136`           | (helpers 사용) | ✅                   |                  |
| `src/tools/defs/project-ops.ts:241`      | (helpers 사용) | ✅                   |                  |

→ 4개 파일에 동일한 try/acquire/finally/release 패턴 중복.

### Eligibility 체크 호출 지점 (Day 1-2 U-P0-8 fix)

| 파일                                                           | `assertProjectMutable` 호출 |
| -------------------------------------------------------------- | --------------------------- |
| `src/web/api/project-routes.ts` (redeploy/rollback/blue-green) | ✅                          |
| 다른 모든 entry points                                         | ❌ (CCG 발견)               |

### Mutation 진입 가능한 entry point 전체 (직접 grep)

| 파일                                                        | 호출하는 pipeline 메서드   | eligibility 체크? |
| ----------------------------------------------------------- | -------------------------- | ----------------- |
| `src/web/api/project-routes.ts` redeploy/rollback/blueGreen | `pipeline.*`               | ✅ Day 1-2        |
| `src/tools/defs/project-ops.ts` redeploy_project            | `pipeline.redeploy`        | ❌                |
| `src/tools/defs/project-ops.ts` rollback_project            | `pipeline.rollback`        | ❌                |
| `src/tools/defs/project-ops.ts` blue_green_deploy_project   | `pipeline.blueGreenDeploy` | ❌                |
| `src/tools/defs/deploy.ts` deploy                           | `pipeline.deploy`          | ❌                |
| `src/tools/defs/env.ts:80` set_env_vars (auto redeploy)     | `pipeline.redeploy`        | ❌                |
| `src/webhook/index.ts:174` webhook handler                  | `pipeline.redeploy` (추정) | ❌                |
| `src/web/api/domain-routes.ts:328` 도메인 변경 후           | `pipeline.redeploy` (추정) | ❌                |
| `src/tools/defs/compose.ts:242` compose rollback            | `pipeline.rollback`        | ❌                |

→ 8개 entry point에서 우회 가능.

---

## 3. 설계 결정

### 3.1 정책을 어디에 두나? (3 옵션)

**옵션 A: 모든 entry point가 직접 `assertProjectMutable` 호출**

- 장점: 변경 범위 작음 (각 caller에 1줄 추가)
- 단점: 새 caller 추가 시 같은 실수 재발. CCG가 발견한 게 정확히 이 패턴.

**옵션 B: `pipeline.redeploy`/`rollback`/`blueGreenDeploy` 진입에서 eligibility 체크**

- 장점: 단일 boundary. 어느 caller든 통과해야 함. 미래 caller 추가 시 자동 보호.
- 단점: pipeline 메서드 시그니처/동작 변화. 회귀 위험 (특히 기존 caller가 throw 예상 안 했다면).

**옵션 C: `withDeployLock(projectId, sessionId, fn)` helper에 정책 통합**

- 장점: lock acquire 시점에 자연스럽게 eligibility 검사. 기존 lock caller 모두 자동 보호.
- 단점: lock 안 쓰는 caller(`pipeline.rollback` 등?)는 미커버.

**최종 결정: B + C 하이브리드**

- `pipeline.{redeploy,rollback,blueGreenDeploy,deploy}` 진입부에 `assertProjectMutable` 강제 호출
- `withDeployLock` helper로 4곳 중복 lock 패턴 통합 (단순화 효과, 정책 중복은 안 함)
- API/MCP route의 기존 `assertProjectMutable`는 _제거_ (pipeline이 책임지므로 중복) — 다만 401/409 에러 분기 위해 남겨두는 게 나을 수도. 결정은 구현 시 trade-off 평가.

### 3.2 새 helper 설계

```ts
// src/db/repos/deploy-lock-helper.ts
export interface DeployLockOptions {
  projectId: string;
  sessionId: string;
  /** Lock 획득 실패 시 throw할 에러 (기본: DeployLockedError) */
  onContention?: () => never;
}

export async function withDeployLock<T>(
  db: Database,
  opts: DeployLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = db.acquireDeployLock(opts.projectId, opts.sessionId);
  if (!acquired) {
    if (opts.onContention) opts.onContention();
    throw new DeployLockedError(opts.projectId);
  }
  try {
    return await fn();
  } finally {
    db.releaseDeployLock(opts.projectId, opts.sessionId);
  }
}
```

### 3.3 Pipeline boundary 정책

**위치**: `src/pipeline/deploy-core.ts`의 `redeploy`/`rollback`/`blueGreenDeploy`/`deploy` 메서드 진입부.

**구현 패턴**:

```ts
async redeploy(projectId: string, opts?: RedeployOptions): Promise<DeployResult> {
  const project = this.db.getProject(projectId);
  if (!project) throw new ProjectNotFoundError(projectId);
  assertProjectMutable(project, this.db);  // ← 새 호출

  const sessionId = opts?.sessionId ?? randomUUID();
  return withDeployLock(this.db, { projectId, sessionId }, async () => {
    // 기존 deploy 로직
  });
}
```

`assertProjectMutable`는 기존 `src/web/api/project-routes.ts`에서 추출하여 `src/pipeline/mutation-policy.ts` 또는 동등 위치로 이동.

### 3.4 MCP/Webhook caller 변경

각 caller에서 명시적 `acquireDeployLock` 호출 제거 (pipeline boundary가 책임):

- `src/tools/defs/helpers.ts:39` — helper 자체 deprecate
- `src/tools/defs/deploy.ts:136`, `project-ops.ts:241` — release 호출 제거 (pipeline 내부에서 finally 처리)

### 3.5 호환성 / 위험

**Breaking changes**:

- `pipeline.redeploy(projectId)` 등이 archived/recovering/circuit_open 상태에서 throw → 기존 caller가 catch 안 하면 unhandled
- 모든 caller가 이미 catch 처리 또는 정상 상태 가정 — 인벤토리 검토 필요

**회귀 위험**:

- e2e/quality-gate spec — redeploy/rollback 시나리오 다수, 정상 상태에서 호출하므로 영향 적을 듯
- env auto-redeploy 시 archived 프로젝트 없을 가정 — 검증 필요

**Mitigation**:

- 단계적 적용: pipeline boundary 추가 → 기존 caller 검증 → MCP path lock 호출 정리
- 단위 테스트: pipeline.redeploy(archived project) → ProjectArchivedError throw 확인

---

## 4. 작업 분해 (Day 5 실행)

| #   | 작업                                                                                               | 추정    |
| --- | -------------------------------------------------------------------------------------------------- | ------- |
| 5.1 | `withDeployLock` helper 신규 (`src/db/repos/deploy-lock-helper.ts`) + 단위 테스트                  | 1.5시간 |
| 5.2 | `assertProjectMutable`을 pipeline-internal helper로 이동 (`src/pipeline/mutation-policy.ts`)       | 30분    |
| 5.3 | `pipeline.redeploy/rollback/blueGreenDeploy/deploy` 진입에 정책 + lock 적용 (`deploy-core.ts`)     | 2시간   |
| 5.4 | 기존 caller 정리: `tools/defs/`, `web/api/`, `webhook/`, `domain-routes.ts` 내 lock 직접 호출 제거 | 1.5시간 |
| 5.5 | U-P0-11: Repo "not found" 표준화 (8 repos) — `ProjectNotFoundError` 등 typed error 통일            | 2시간   |
| 5.6 | 신규 + 회귀 테스트 (특히 e2e/quality-gate 회귀 위험)                                               | 1.5시간 |
| 5.7 | code-reviewer 패스 + commit                                                                        | 1시간   |

**총 추정 10시간** (Day 1-3보다 큼). Day 5 + Day 6 일부로 분할 검토.

---

## 5. Day 6/7 영향

- Day 6 AGENTS.md 정책 명문화: **withDeployLock + assertProjectMutable** 패턴을 "모든 mutation 진입은 pipeline boundary 통과 필수" 규칙으로 명시
- Day 7 verifier 게이트: e2e/quality-gate 27 spec 모두 PASS 확인

---

## 6. 미결 결정 (구현 시 결정)

1. **API route의 `assertProjectMutable` 호출 유지 vs 제거**:
   - 유지: 빠른 거부, 명확한 HTTP 409
   - 제거: pipeline이 throw하면 onError가 처리 — 단일 책임이지만 한 hop 추가
   - 권장: **유지** (사용자 가시 응답 빠름, 중복은 OK)

2. **`compose.rollback` 별도 처리 필요?**:
   - `src/tools/defs/compose.ts:242` `appCtx.pipeline.rollback(service.projectId)` — pipeline boundary 정책에 자동 보호
   - 단, compose는 batch rollback이라 atomic 보장 필요. 한 service rollback 시 다른 service에 영향 없는지 확인

3. **Webhook 자동 redeploy의 archived 프로젝트 처리**:
   - 사용자가 webhook 설정 후 프로젝트 archive → push 발생 → 자동 redeploy 시도
   - 정책: archive 시 webhook 자동 비활성? 아니면 webhook 호출 시 `ProjectArchivedError` 정상 응답?
   - 권장: webhook handler가 `ProjectArchivedError` catch 후 200 + body에 "archived, skipped" — push 자체는 정상 처리 의미

---

## 7. Day 5 시작 체크리스트

- [ ] Day 4 commit 완료
- [ ] Day 4 follow-up Major 3건 모두 처리됨 (recovery:degraded listener, void→catch, signal trigger)
- [ ] Pipeline boundary 추가 전 기존 caller 인벤토리 한 번 더 grep으로 확인
- [ ] e2e/quality-gate 영향 분석 1차

---

본 디자인은 Day 5 시작 시 구현 자료로 사용. executor에게 이 문서를 컨텍스트로 전달하면 빠르게 진행 가능.
