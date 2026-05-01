# Quality Gate — Test Coverage Mapping

> **Generated**: 2026-03-25
> **Sources**: `docs/planning/release/quality-gate.md`, `docs/planning/release-checklist.md`, `e2e/quality-gate/*.spec.ts`

---

## Table 1: Test Scenarios → Release Checklist

| Test File              | Test Scenarios                                                                         | Checklist Items Covered                                       |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `deploy-git.spec.ts`   | Scenario A: R1 (single Dockerfile) deploy via Web UI reaches running and serves OK     | Checklist §3 (GitHub 연동 배포), §4 (URL 직접 입력 배포)      |
| `deploy-git.spec.ts`   | Scenario B: R2 (no Dockerfile) deploy via API auto-detects and reaches running         | Checklist §3 (GitHub 연동 배포) — auto-detect path            |
| `compose.spec.ts`      | Deploys compose repo (R3), emits compose events, serves /count endpoint                | Checklist §7 (Docker Compose 배포)                            |
| `recovery.spec.ts`     | Scenario A: R5 build fail emits deploy:failed + recovery:start                         | Checklist §8 (빌드 실패 → AI 자동 복구) — build failure path  |
| `recovery.spec.ts`     | Scenario B: R6 runtime crash emits deploy:success then crash + recovery:start          | Checklist §8 (빌드 실패 → AI 자동 복구) — runtime crash path  |
| `lifecycle.spec.ts`    | Redeploy creates new deployment; rollback emits rollback event and returns to running  | Checklist §9 (Redeploy), §11 (롤백)                           |
| `blue-green.spec.ts`   | Blue-green deploy swaps container without downtime                                     | Checklist §10 (Blue-Green)                                    |
| `webhook.spec.ts`      | Signed GitHub webhook triggers redeploy with webhook trigger                           | Checklist §15 (Webhook 자동 재배포)                           |
| `env-vars.spec.ts`     | Scenario A: R7 deploy without DATABASE_URL ends in error/stopped                       | Checklist §13 (환경변수 관리) — missing env failure           |
| `env-vars.spec.ts`     | Scenario B: set DATABASE_URL then redeploy reaches running                             | Checklist §13 (환경변수 관리) — env set + redeploy            |
| `mcp.spec.ts`          | initialize + create_deploy_plan + execute_deploy_plan + status polling reaches running | Checklist §20 (MCP 서버)                                      |
| `deploy-image.spec.ts` | Deploys nginx image via API without clone/build stages                                 | No direct checklist item (image deploy path not in checklist) |

---

## Table 2: Entry Point x Variant Coverage Matrix

Entry points (E1-E6) and variants (V1-V6) are defined in `docs/planning/release/quality-gate.md`.

|                          | V1 (Dockerfile)                                                         | V2 (Compose) | V3 (Auto-Dockerfile) | V4 (Monorepo) | V5 (Blue-Green) | V6 (Preview) |
| ------------------------ | ----------------------------------------------------------------------- | ------------ | -------------------- | ------------- | --------------- | ------------ |
| **E1 (Web UI Deploy)**   | `deploy-git.spec.ts` Scenario A                                         |              |                      |               |                 |              |
| **E2 (Web UI Redeploy)** | `lifecycle.spec.ts` (redeploy step)                                     |              |                      |               |                 |              |
| **E3 (Agent tool)**      |                                                                         |              |                      |               |                 |              |
| **E4 (MCP tool)**        | `mcp.spec.ts`                                                           |              |                      |               |                 |              |
| **E5 (Webhook)**         | `webhook.spec.ts`                                                       |              |                      |               |                 |              |
| **E6 (Auto-Recovery)**   | `recovery.spec.ts` Scenario A (build fail) + Scenario B (runtime crash) |              |                      |               |                 |              |

Additional coverage not fitting the E x V matrix:

| Test File                       | What It Covers                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `deploy-git.spec.ts` Scenario B | E1 (API path) x V3 (Auto-Dockerfile) — R2 has no Dockerfile, triggers auto-detect |
| `compose.spec.ts`               | E1 (API path) x V2 (Compose)                                                      |
| `blue-green.spec.ts`            | E1 (API path) x V5 (Blue-Green)                                                   |
| `env-vars.spec.ts`              | E2 (Redeploy) x V1 (Dockerfile) — env var injection + redeploy                    |
| `deploy-image.spec.ts`          | Docker image deploy (no git clone/build) — not in E x V matrix                    |
| `lifecycle.spec.ts`             | E2 (Redeploy) x V1 + rollback                                                     |

---

## Table 3: Uncovered Paths

### Entry Point x Variant gaps

| Entry Point          | Variant              | Status                                                                         |
| -------------------- | -------------------- | ------------------------------------------------------------------------------ |
| E1 (Web UI Deploy)   | V2 (Compose)         | Not covered — compose.spec.ts uses API path, not Web UI                        |
| E1 (Web UI Deploy)   | V3 (Auto-Dockerfile) | Not covered — deploy-git.spec.ts Scenario B uses API path                      |
| E1 (Web UI Deploy)   | V4 (Monorepo)        | Not covered                                                                    |
| E1 (Web UI Deploy)   | V5 (Blue-Green)      | Not covered — blue-green.spec.ts uses API path                                 |
| E1 (Web UI Deploy)   | V6 (Preview)         | Not covered                                                                    |
| E2 (Web UI Redeploy) | V2 (Compose)         | Not covered                                                                    |
| E2 (Web UI Redeploy) | V3 (Auto-Dockerfile) | Not covered                                                                    |
| E2 (Web UI Redeploy) | V4 (Monorepo)        | Not covered                                                                    |
| E2 (Web UI Redeploy) | V5 (Blue-Green)      | Not covered                                                                    |
| E2 (Web UI Redeploy) | V6 (Preview)         | Not covered                                                                    |
| E3 (Agent tool)      | V1-V6 (all)          | Not covered — no E2E test for agent-initiated deploys                          |
| E4 (MCP tool)        | V2 (Compose)         | Not covered                                                                    |
| E4 (MCP tool)        | V3 (Auto-Dockerfile) | Not covered                                                                    |
| E4 (MCP tool)        | V4 (Monorepo)        | Not covered                                                                    |
| E4 (MCP tool)        | V5 (Blue-Green)      | Not covered                                                                    |
| E4 (MCP tool)        | V6 (Preview)         | Not covered                                                                    |
| E5 (Webhook)         | V2 (Compose)         | Not covered                                                                    |
| E5 (Webhook)         | V3 (Auto-Dockerfile) | Not covered                                                                    |
| E5 (Webhook)         | V4 (Monorepo)        | Not covered                                                                    |
| E5 (Webhook)         | V5 (Blue-Green)      | Not covered                                                                    |
| E5 (Webhook)         | V6 (Preview)         | Not covered                                                                    |
| E6 (Auto-Recovery)   | V2 (Compose)         | Not covered — quality-gate.md Scenario 4 (compose + auto-recovery) has no spec |
| E6 (Auto-Recovery)   | V3-V6                | Not covered                                                                    |

### Quality-gate.md scenarios without a spec file

| Scenario (from quality-gate.md)                      | Status                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Scenario 2: Private Repo + SSH Key (V1, E1)          | No spec — requires SSH key on test runner                                        |
| Scenario 3: Private Repo + GitHub Token (V1, E1)     | No spec — requires private repo + token                                          |
| Scenario 4: Compose Deploy + Auto-Recovery (V2 + E6) | No spec                                                                          |
| Scenario 5: Dockerfile Fix Loop (V1, E1)             | No spec — recovery.spec.ts covers build fail event emission but not the fix loop |
| Scenario 7: MCP Deploy (V1, E4)                      | Partially covered by mcp.spec.ts (create_deploy_plan + execute_deploy_plan)      |

### Release checklist items without E2E coverage

| Checklist Scenario                   | Status                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| §1 Setup/Onboarding                  | No E2E spec                                               |
| §2 GitHub 연결/해제                  | No E2E spec                                               |
| §4 URL 직접 입력 배포 (DeployDialog) | No E2E spec — checklist notes it as legacy/secondary path |
| §5 Private Repo (SSH)                | No E2E spec                                               |
| §6 Private Repo (Token)              | No E2E spec                                               |
| §12 Start/Stop                       | No E2E spec                                               |
| §14 도메인 & 공개                    | No E2E spec                                               |
| §16 공유 서비스                      | No E2E spec                                               |
| §17 로그 & 배포 히스토리             | No E2E spec                                               |
| §18 알림                             | No E2E spec                                               |
| §19 커맨드 팔레트                    | No E2E spec                                               |
| §21 AI 인라인 분석                   | No E2E spec                                               |
| §22 시크릿 스캔                      | No E2E spec                                               |
| §23 포스트모템 자동 생성             | No E2E spec                                               |
| §24 롤백 자동 제안                   | No E2E spec                                               |
| §25 환경변수 변경 감지               | No E2E spec                                               |

### Tier 3 paths (intentionally excluded per spec)

- V4 (Monorepo) E2E
- V6 (Preview) E2E
- SSH key matrix (C1-C12 from Q-3) — unit test scope, not E2E
