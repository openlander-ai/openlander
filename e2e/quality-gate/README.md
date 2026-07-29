# E2E Quality Gate

Operational guide for running the quality-gate E2E test suite against a live OpenLander instance.

## Prerequisites

| Requirement       | Detail                                                                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenLander server | Running at `localhost:10114` by default, or `OPENLANDER_E2E_BASE_URL` when testing a separate candidate. `global-setup.ts` provisions the E2E password/token for a fresh auth-enabled server. |
| Docker daemon     | Running and accessible                                                                                                                                                                        |
| Test repositories | 7 repos in `openlander-ai` GitHub org: `test-single-dockerfile`, `test-no-dockerfile`, `test-compose-multi`, `test-monorepo`, `test-build-fail`, `test-runtime-crash`, `test-env-required`    |
| cloudflared       | Optional. Tunnel tests skipped if absent.                                                                                                                                                     |

Start the server for E2E:

```bash
npm run build
node dist/cli/index.js --no-open
```

When `localhost:10114` is already occupied by a dogfood instance, use a
dedicated VM/VPS or a separate Docker daemon for the candidate and point the
tests at it:

```bash
OPENLANDER_DATA_DIR=/tmp/openlander-e2e-data node dist/cli/index.js --no-open --port 10115
OPENLANDER_E2E_BASE_URL=http://localhost:10115 npx playwright test --project=quality-gate
```

Do not run two OpenLander servers against the same Docker daemon for full
quality-gate validation. Startup monitors reconcile managed `ol-*` containers
against the active database, and deploy tests create/remove `ol-*` app
containers.

## Running

```bash
# Default suite (excludes slow compose and 0.2-deferred recovery/OpsAgent tests)
npx playwright test --project=quality-gate

# Slow compose lane
OPENLANDER_E2E_SLOW=1 npx playwright test --project=quality-gate e2e/quality-gate/compose.spec.ts
OPENLANDER_E2E_SLOW=1 npx playwright test --project=quality-gate e2e/quality-gate/event-sequences.spec.ts -g "Compose Deploy"

# Single spec
npx playwright test --project=quality-gate e2e/quality-gate/deploy-git.spec.ts

# Grep filter
npx playwright test --project=quality-gate -g "Scenario A"

# Auth tests only
npx playwright test --project=quality-gate e2e/quality-gate/auth.spec.ts

# RC cold-agent smoke on a fresh/dedicated QA host
OPENLANDER_E2E_BASE_URL=http://localhost:10114 npm run qa:rc-smoke
OPENLANDER_E2E_BASE_URL=http://localhost:10114 OPENLANDER_E2E_SLOW=1 npm run qa:rc-smoke

# RC cold-agent smoke on a fresh GitHub-hosted Docker runner
gh workflow run release-gate.yml --ref v0.1.9-rc.1 \
  -f rc_smoke=true \
  -f rc_image=ghcr.io/openlander-ai/openlander:0.1.9-rc.1
```

The RC smoke runner refuses to start when it detects existing OpenLander-owned
app/service containers (`ol-*`) beyond the baseline runtime containers. Use a
clean QA host or remove stale smoke-test residue before rerunning it.

## Architecture

```
e2e/quality-gate/
  global-setup.ts      Auth setup + precondition checks (server, Docker, repos, cloudflared)
  global-teardown.ts   Project + instance-owned container cleanup
  fixtures/
    api.ts             apiFetch() with auth header injection, deploy/CRUD/lifecycle helpers
    stream-consumer.ts NDJSON stream consumer with waitForEvent()
    event-types.ts     Stream event type definitions
  *.spec.ts            Test specs (serial mode per describe block)
```

`global-setup.ts` detects no-auth mode or issues an API token when auth is
enabled. All fixture functions use `apiFetch()` which injects the configured
auth header automatically.

## Release Scope

0.1.x keeps built-in RecoveryCoordinator/OpsAgent behavior dormant. The
`recovery.spec.ts` and `ops-agent.spec.ts` suites stay deferred in this Docker
E2E gate until the 0.2 product surface, docs, and regression tests are restored
together. Backend route/policy contracts remain covered by Vitest release tests.

## Test Matrix

| #   | Spec                            | Test                                                    | Duration | Status       |
| --- | ------------------------------- | ------------------------------------------------------- | -------- | ------------ |
| 1   | blue-green.spec.ts              | Blue-green deploy swaps container                       | ~23s     | pass         |
| 2   | compose.spec.ts                 | Compose multi-service deploy + /count                   | ~5min    | slow         |
| 3   | deploy-git.spec.ts              | R1 deploy via API reaches running + curl OK             | ~9s      | pass         |
| 4   | deploy-git.spec.ts              | R2 auto-detect deploy reaches running                   | ~18s     | pass         |
| 5   | deploy-image.spec.ts            | Docker image deploy without clone/build                 | ~5s      | pass         |
| 6   | env-vars.spec.ts                | R7 deploy without DATABASE_URL -> error                 | ~45s     | pass         |
| 7   | env-vars.spec.ts                | Set DATABASE_URL + redeploy -> running                  | ~6s      | pass         |
| 8   | event-sequences.spec.ts         | Git Deploy (Dockerfile) event sequence                  | ~11s     | pass         |
| 9   | event-sequences.spec.ts         | Git Deploy (Auto-detect) event sequence                 | ~16s     | pass         |
| 10  | event-sequences.spec.ts         | Image Deploy event sequence                             | ~4s      | pass         |
| 11  | event-sequences.spec.ts         | Compose Deploy reaches running                          | ~5min    | slow         |
| 12  | event-sequences.spec.ts         | Build Fail ends with error event                        | ~9s      | pass         |
| 13  | event-sequences.spec.ts         | Runtime Crash deploy succeeds                           | ~11s     | pass         |
| 14  | event-sequences.spec.ts         | Blue-Green standalone project                           | ~16s     | pass         |
| 15  | event-sequences.spec.ts         | Rollback standalone project                             | ~24s     | pass         |
| 16  | lifecycle.spec.ts               | Redeploy + rollback emits events                        | ~35s     | pass         |
| 17  | mcp.spec.ts                     | MCP initialize + deploy plan + polling                  | ~4s      | pass         |
| 18  | delivery-workspace-live.spec.ts | Production deploy → approval/Gates → immutable Receipt  | ~1min    | rc-smoke     |
| 19  | managed-services.spec.ts        | RC smoke: MCP deploy + PostgreSQL/Redis + topology/logs | ~3min    | rc-smoke     |
| 20  | recovery.spec.ts                | R5 build fail -> error/stopped                          | ~9s      | **deferred** |
| 21  | recovery.spec.ts                | R6 runtime crash detected                               | ~55s     | **deferred** |
| 22  | webhook.spec.ts                 | Signed webhook triggers redeploy                        | ~11s     | pass         |
| 23  | ops-agent.spec.ts               | OpsAgent health endpoint                                | <1s      | **deferred** |
| 24  | ops-agent.spec.ts               | Incidents list returns array                            | <1s      | **deferred** |
| 25  | ops-agent.spec.ts               | Config endpoint returns enabled flag                    | <1s      | **deferred** |
| 26  | ops-agent.spec.ts               | Circuit breaker endpoint graceful                       | <1s      | **deferred** |
| 27  | ops-agent.spec.ts               | Digest trigger returns triggered:true                   | <1s      | **deferred** |
| 28  | ops-agent.spec.ts               | Crash creates ops_incident (Docker)                     | ~2min    | **deferred** |
| 29  | ops-agent.spec.ts               | Circuit breaker reset works (Docker)                    | ~3min    | **deferred** |

Auth tests skip automatically when the target is detected as no-auth. The 0.1
runtime is auth-enabled by default; to verify the auth surface itself, run
`auth.spec.ts` against that normal server mode.

## Slow And Deferred Tests

| Test                            | Root Cause                                                                                                  | Remediation                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| compose.spec.ts                 | Docker build takes 4min+. The default quality gate stays fast.                                              | Run with `OPENLANDER_E2E_SLOW=1` or move this to a dedicated slow CI job.                                                               |
| event-sequences Compose Deploy  | Same as above.                                                                                              | Run with `OPENLANDER_E2E_SLOW=1` or move this to a dedicated slow CI job.                                                               |
| delivery-workspace-live.spec.ts | Finalized Receipts intentionally block Project hard-delete.                                                 | Run only with `OPENLANDER_E2E_EPHEMERAL=1`; the runtime and Postgres volume must be destroyed after the suite.                          |
| managed-services.spec.ts        | Pulls database/cache images and mutates project-scoped managed services.                                    | Run through `npm run qa:rc-smoke` on a fresh/dedicated release QA host.                                                                 |
| recovery.spec.ts                | RecoveryCoordinator is dormant in 0.1.x.                                                                    | Re-enable only with the 0.2 recovery product surface, docs, and regression suite.                                                       |
| ops-agent.spec.ts               | Agent Ops/OpsCenter is dormant in 0.1.x.                                                                    | Keep Vitest backend contract coverage; re-enable Docker E2E when Agent Ops is re-surfaced.                                              |
| auth.spec.ts (10 tests)         | Require auth middleware active. If the target API is already open, these tests are skipped in no-auth mode. | Run separately: `npx playwright test --project=quality-gate e2e/quality-gate/auth.spec.ts` against the normal auth-enabled server mode. |

## Troubleshooting

| Symptom                                  | Cause                                                            | Fix                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container name conflict (`409 Conflict`) | Orphan container from previous run                               | Remove only E2E-owned containers whose names start with `ol-test-`, `ol-golden-`, `ol-qg-`, `ol-qa-`, `ol-mcp-`, `ol-svc-test-`, `ol-svc-golden-`, `ol-svc-qg-`, `ol-svc-qa-`, or `ol-svc-mcp-`. |
| `Branch 'default' not found`             | Deploy API called without branch                                 | Always pass `branch: 'main'` in deploy calls. `deployGitProject()` defaults to `'main'`.                                                                                                         |
| `401 Unauthorized` on API calls          | Server requires auth                                             | Let `global-setup.ts` issue the token, or set `process.env.OPENLANDER_API_TOKEN` explicitly.                                                                                                     |
| Stream timeout (no `complete` event)     | Stream consumer connected after deploy finished                  | Use `waitForStatus()` polling instead of stream-based waiting.                                                                                                                                   |
| `curl: Connection reset by peer`         | Container not ready immediately after start                      | `assertLocalOkResponse` retries 5 times with 2s delay. Increase if needed.                                                                                                                       |
| `SETUP_REQUIRED` (403)                   | Server has no password set                                       | `global-setup.ts` handles this automatically. If running manually, call `POST /api/auth/setup-password`.                                                                                         |
| `npm error code EUSAGE`                  | Auto-generated Dockerfile uses `npm ci` but repo has no lockfile | Fixed in `dockerfile-gen.ts`. If seen, ensure the server is running updated code.                                                                                                                |
