# E2E Quality Gate

Operational guide for running the quality-gate E2E test suite against a live OpenLander instance.

## Prerequisites

| Requirement       | Detail                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OpenLander server | Running at `localhost:10114` with `OPENLANDER_NO_AUTH=1`                                                                                                                                   |
| Docker daemon     | Running and accessible                                                                                                                                                                     |
| Test repositories | 7 repos in `openlander-ai` GitHub org: `test-single-dockerfile`, `test-no-dockerfile`, `test-compose-multi`, `test-monorepo`, `test-build-fail`, `test-runtime-crash`, `test-env-required` |
| cloudflared       | Optional. Tunnel tests skipped if absent.                                                                                                                                                  |

Start the server for E2E:

```bash
npm run build
OPENLANDER_NO_AUTH=1 node dist/cli/index.js --no-open
```

## Running

```bash
# Full suite (~6-7 min, excludes fixme tests)
npx playwright test --project=quality-gate

# Single spec
npx playwright test --project=quality-gate e2e/quality-gate/deploy-git.spec.ts

# Grep filter
npx playwright test --project=quality-gate -g "Scenario A"

# Auth tests only (requires server WITHOUT OPENLANDER_NO_AUTH)
npx playwright test --project=quality-gate e2e/quality-gate/auth.spec.ts
```

## Architecture

```
e2e/quality-gate/
  global-setup.ts      Auth setup + precondition checks (server, Docker, repos, cloudflared)
  global-teardown.ts   Project + container cleanup
  fixtures/
    api.ts             apiFetch() with auth header injection, deploy/CRUD/lifecycle helpers
    stream-consumer.ts NDJSON stream consumer with waitForEvent()
    event-types.ts     Stream event type definitions
  *.spec.ts            Test specs (serial mode per describe block)
```

`global-setup.ts` sets a password if needed and stores the API token in `process.env.OPENLANDER_API_TOKEN`. All fixture functions use `apiFetch()` which injects `Authorization: Bearer <token>` automatically.

## Test Matrix

| #   | Spec                    | Test                                        | Duration | Status    |
| --- | ----------------------- | ------------------------------------------- | -------- | --------- |
| 1   | blue-green.spec.ts      | Blue-green deploy swaps container           | ~23s     | pass      |
| 2   | compose.spec.ts         | Compose multi-service deploy + /count       | ~5min    | **fixme** |
| 3   | deploy-git.spec.ts      | R1 deploy via API reaches running + curl OK | ~9s      | pass      |
| 4   | deploy-git.spec.ts      | R2 auto-detect deploy reaches running       | ~18s     | pass      |
| 5   | deploy-image.spec.ts    | Docker image deploy without clone/build     | ~5s      | pass      |
| 6   | env-vars.spec.ts        | R7 deploy without DATABASE_URL -> error     | ~45s     | pass      |
| 7   | env-vars.spec.ts        | Set DATABASE_URL + redeploy -> running      | ~6s      | pass      |
| 8   | event-sequences.spec.ts | Git Deploy (Dockerfile) event sequence      | ~11s     | pass      |
| 9   | event-sequences.spec.ts | Git Deploy (Auto-detect) event sequence     | ~16s     | pass      |
| 10  | event-sequences.spec.ts | Image Deploy event sequence                 | ~4s      | pass      |
| 11  | event-sequences.spec.ts | Compose Deploy reaches running              | ~5min    | **fixme** |
| 12  | event-sequences.spec.ts | Build Fail ends with error event            | ~9s      | pass      |
| 13  | event-sequences.spec.ts | Runtime Crash deploy succeeds               | ~11s     | pass      |
| 14  | event-sequences.spec.ts | Blue-Green reuses R1 project                | ~16s     | pass      |
| 15  | event-sequences.spec.ts | Rollback reuses R1 project                  | ~24s     | pass      |
| 16  | lifecycle.spec.ts       | Redeploy + rollback emits events            | ~35s     | pass      |
| 17  | mcp.spec.ts             | MCP initialize + deploy plan + polling      | ~4s      | pass      |
| 18  | recovery.spec.ts        | R5 build fail -> error/stopped              | ~9s      | pass      |
| 19  | recovery.spec.ts        | R6 runtime crash detected                   | ~55s     | pass      |
| 20  | webhook.spec.ts         | Signed webhook triggers redeploy            | ~11s     | pass      |

Auth tests (10 tests in `auth.spec.ts`) require a separate run without `OPENLANDER_NO_AUTH`.

## fixme Tests

| Test                           | Root Cause                                                                                                                              | Remediation                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| compose.spec.ts                | Docker build takes 4min+. Pipeline clones to a new tmpdir each deploy (`mkdtemp`), invalidating Docker layer cache despite `cacheFrom`. | Use a pre-built test image in the compose repo, or run in a dedicated slow CI job.                                                                |
| event-sequences Compose Deploy | Same as above.                                                                                                                          | Same as above.                                                                                                                                    |
| auth.spec.ts (10 tests)        | Require auth middleware active. `OPENLANDER_NO_AUTH=1` bypasses all auth, so these tests see 200 instead of 401.                        | Run separately: `npx playwright test --project=quality-gate e2e/quality-gate/auth.spec.ts` against a server started without `OPENLANDER_NO_AUTH`. |

## Product Fixes Included

Changes to `src/` made alongside this E2E work:

| File                             | Change                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/pipeline/dockerfile-gen.ts` | `npm ci` -> `npm install` fallback when no `package-lock.json` (all 7 Node.js templates)                                   |
| `src/pipeline/compose.ts`        | Force-remove stale service containers before orchestration                                                                 |
| `src/pipeline/docker.ts`         | Added `cacheFrom` option to `BuildComposeServiceOptions`                                                                   |
| `src/monitor/health.ts`          | Crash loop detection (`RestartCount >= 3` -> status='error') + container exit detection (`ExitCode != 0` when not running) |
| `src/web/middleware/auth.ts`     | `OPENLANDER_NO_AUTH=1` env var bypass                                                                                      |
| `src/mcp/server.ts`              | `OPENLANDER_NO_AUTH=1` bypass for MCP Bearer auth                                                                          |

## Troubleshooting

| Symptom                                  | Cause                                                            | Fix                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Container name conflict (`409 Conflict`) | Orphan container from previous run                               | `docker rm -f $(docker ps -a --filter name=ol-test -q)`                                                  |
| `Branch 'default' not found`             | Deploy API called without branch                                 | Always pass `branch: 'main'` in deploy calls. `deployGitProject()` defaults to `'main'`.                 |
| `401 Unauthorized` on API calls          | Server requires auth                                             | Start server with `OPENLANDER_NO_AUTH=1` or check `process.env.OPENLANDER_API_TOKEN` is set.             |
| Stream timeout (no `complete` event)     | Stream consumer connected after deploy finished                  | Use `waitForStatus()` polling instead of stream-based waiting.                                           |
| `curl: Connection reset by peer`         | Container not ready immediately after start                      | `assertLocalOkResponse` retries 5 times with 2s delay. Increase if needed.                               |
| `SETUP_REQUIRED` (403)                   | Server has no password set                                       | `global-setup.ts` handles this automatically. If running manually, call `POST /api/auth/setup-password`. |
| `npm error code EUSAGE`                  | Auto-generated Dockerfile uses `npm ci` but repo has no lockfile | Fixed in `dockerfile-gen.ts`. If seen, ensure the server is running updated code.                        |
