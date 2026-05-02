# OpenLander Release Gate

This document defines the pre-open QA gate. It separates fast required checks
from Docker/browser checks that are valuable but slower or environment-sensitive.

## Required Automated Gate

Run this before merging release-facing backend or platform changes:

```bash
npm run qa:release
```

`npm test` is intentionally aliased to the same Postgres-ready backend release
suite. Legacy SQLite in-memory integration tests are not part of the default
gate after the Postgres cutover.

The command runs:

- `npm run lint -- --quiet`
- `npm run typecheck`
- `npm run test:backend:release`
- `npm run build`

Target coverage:

- Postgres migration file sanity and schema parity without Docker
- REST/API wire-shape smoke tests that do not require a live database
- auth/OAuth token flow checks that do not require DB state
- deploy mutation policy, readiness, and no-DB recovery policy checks
- Operations Center agent/recovery logic that does not require DB state
- MCP/tool registry and mutation-policy tool surface

The required gate must not require Docker daemon access. Docker-backed E2E,
soak, and browser-only checks stay outside the required PR gate.

> Postgres-backed integration tests are a follow-up lane. The old SQLite
> in-memory suites are intentionally excluded until they are converted to an
> `OPENLANDER_TEST_DATABASE_URL`-based harness.

## Focused Local Suites

Use these commands when a change is narrower than the full gate:

```bash
npm run test:migrations
npm run test:api-contract
npm run test:backend:release
```

`test:migrations` is the DB safety lane. `test:api-contract` is the wire-shape
compatibility lane. `test:backend:release` is the combined release-critical
backend suite that can run without Docker or a live Postgres service.

## CI Policy

- `.github/workflows/release-gate.yml` runs `npm run qa:release` on PRs to
  `develop` or `main`, and on pushes to `develop`.
- `.github/workflows/contract-tests.yml` remains the seeded backend + web
  contract lane.
- `.github/workflows/ci.yml` remains the main-branch full gate with coverage
  and build.
- All CI lanes pin npm through Corepack to `npm@11.5.1` before `npm ci`.

## Manual Docker Gate

Run these only on a host with Docker available:

```bash
npm run test:e2e -- --project=quality-gate
```

For release candidates, run at least one short soak dry run before a longer
watch:

```bash
SOAK_DATABASE_URL='postgres://user:password@localhost:5432/openlander_soak' \
  SOAK_DURATION_SEC=900 SOAK_CYCLE_SEC=120 tools/qa/soak-test.sh start
tools/qa/soak-test.sh status
tools/qa/soak-test.sh stop
```

Check production or dogfood logs before tagging:

```bash
tools/qa/soak-grep.sh ~/.openlander/error.log
```

## No-Go Criteria

Block release if any of these are observed:

- migration failure, schema mismatch, or DB data loss
- purge/delete affecting another project
- unauthenticated access to protected routes
- duplicate deploy containers for one project due to lock failure
- unbounded recovery/LLM loop or repeated token-consuming retries
- Docker volume loss for services meant to preserve data

## Data Preservation Policy

OpenLander DB data and Docker volumes are preservation targets. Deployed
project containers and runtime project state may be deleted and recreated when
necessary, as long as DB state and named volumes are not lost.
