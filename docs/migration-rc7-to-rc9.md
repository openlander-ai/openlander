# Migrating from 1.0.0-rc.5 / rc.7 to 1.0.0

If you've been running an `rc.5` or `rc.7` build and are upgrading to `1.0.0`, this guide walks through the schema changes, the API surface that changed, and the pre-upgrade safety check we recommend.

> **Fresh installs (no prior data) skip this guide.** The schema is created from scratch and there's nothing to migrate.

---

## 1. Back up your data first

The migrator runs SQLite DDL (CREATE/INSERT/DROP/RENAME) inside transactions, but you should still snapshot your data before upgrading. The migration runs automatically on first boot of the new build, and Drizzle does not support down-migrations.

```bash
# Stop the running instance
pm2 stop openlander           # or however you run it

# Snapshot the data dir
cp -a ~/.openlander ~/.openlander.bak-rc7-$(date +%Y%m%d)
```

If anything goes wrong, restore the directory and downgrade.

---

## 2. Pre-upgrade safety check (mandatory if you may have non-canonical `result` values)

Migration `0003_fix_check_constraints.sql` rebuilds `ai_usage_log` **without** the legacy `result` CHECK so the table can be reshaped. Migration `0004_restore_ai_usage_result_check.sql` then rebuilds the table again **with** `CHECK("result" IN ('success', 'failure', 'partial'))` and copies rows back via `INSERT … SELECT`.

That `INSERT … SELECT` will FAIL on the first row whose `result` is outside the canonical enum — the migration aborts and the upgrade rolls back. Existing invalid rows do **not** silently survive. The error you will see in the boot log is:

```
SqliteError: CHECK constraint failed: ai_usage_log_result_check
```

This behaviour is covered by `test/db/migration-realistic-data.test.ts` (Scenario 2) on every CI run, so a regression here will be caught before release.

Run this against your live DB before upgrading:

```bash
sqlite3 ~/.openlander/openlander.db \
  "SELECT DISTINCT result FROM ai_usage_log
   WHERE result NOT IN ('success', 'failure', 'partial');"
```

- **Empty output** → safe. Skip to step 3.
- **Any rows returned** → migration `0004` will refuse to apply. Either rewrite those rows to one of the canonical values (`UPDATE ai_usage_log SET result = 'failure' WHERE result NOT IN ('success', 'failure', 'partial');`) or open an issue with the offending value (we'll add it to the enum if it should have been valid).

### Recovery if you skipped the pre-flight and the boot crashed

The migration runs inside a SQLite transaction; the `CHECK` failure aborts before any rows are dropped. Verify with:

```bash
sqlite3 ~/.openlander/openlander.db "SELECT COUNT(*) FROM ai_usage_log;"
sqlite3 ~/.openlander/openlander.db "SELECT COUNT(*) FROM __drizzle_migrations;"
# Migration count should still be 3 (0000-0002) — neither 0003 nor 0004 was recorded.
```

If both counts match what you had on rc.7, the DB is intact: run the cleanup `UPDATE` above, then restart. If the migration count moved past 3 you have a partial-state DB — restore from the snapshot in step 1.

---

## 3. Run the upgrade

```bash
# Pull the new build
npm install -g openlander@1.0.0    # global install
# OR
git pull && npm install && npm run build   # source build

# Start
pm2 restart openlander    # or your start command
```

On first boot the migrator applies every Drizzle migration whose row is missing from `__drizzle_migrations`. Both rc.5 and rc.7 predate the Drizzle Kit migrator (it was introduced as part of the 1.0 line), so on either baseline the migrator will apply `0000` → `0001` → `0002` → `0003` → `0004` → `0005` to bring the DB up to the 1.0 schema. Boot logs include lines like:

```
{"module":"db","msg":"Drizzle migrations applied","applied":6}
```

---

## 4. What changed (API and behaviour)

### 4.1 New 409 responses on mutating routes

`POST /api/projects/:id/{redeploy,rollback,blue-green}` and the corresponding MCP tools now return `409 Conflict` with a typed code when the target project is not in a mutatable state:

| Code                   | Meaning                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `PROJECT_ARCHIVED`     | Project has been archived. Unarchive before mutating.               |
| `PROJECT_RECOVERING`   | Auto-recovery is in progress. Wait for it to complete or fail.      |
| `CIRCUIT_BREAKER_OPEN` | Recovery has tripped the breaker. Reset it from the Operations tab. |
| `DEPLOY_LOCKED`        | Another deploy on this project is in progress.                      |

Previous behaviour for these cases was either a 200 with `{ success: false }`, a generic 500, or — for the MCP fire-and-forget tools — a fake "redeploying" response while the pipeline silently rejected. The new typed 409 is the correct outcome at every entry point.

### 4.2 `statusUrl` on deploy responses

`POST /api/projects/deploy` and `/api/deploy/start` responses now include a `statusUrl` field pointing to the project endpoint clients can poll for status. Existing clients that ignore extra fields keep working; new clients should use the URL instead of constructing it themselves.

### 4.3 LLM circuit breaker now records cancellations

If a chat or recovery LLM call is cancelled mid-stream (user abort, client disconnect, AbortSignal.timeout), the cancellation now counts as a failure for the LLM circuit breaker. Repeated cancellations will trip the breaker, which is the intended behaviour — runaway abort loops will no longer rack up cost forever.

If you script automated calls that legitimately cancel often, expect the breaker to open faster than in `rc.7`. Reset is via the Operations dashboard or the same `/ops/circuit-breaker` endpoints.

> **Single-tenant LLM pool**: 1.0 ships with a hard cap of 5 concurrent LLM sessions across the entire process and is not partitioned per user. Multi-user concurrent operation will surface as `429 LLM_CONCURRENCY_EXCEEDED` once the cap is hit. Per-tenant fairness is planned for v1.1.

### 4.4 Webhook auto-redeploy degrades gracefully

When a push event lands for an archived / recovering / circuit-broken project, the webhook handler now responds `{ accepted: true, message: "...skipped" }` (HTTP 200). Previously the same situation either errored or attempted a deploy that the policy rejected.

### 4.5 Recovery partial-failure events

When a recovery step fails mid-pipeline (e.g. a state transition fails after the queue accepted the work), a new `recovery:degraded` event is emitted. `ActivityLogger` persists every occurrence to the `activity_log` table, replacing the previously silent `log.warn` line. Surfacing the event in the Operations Live feed (the `/api/activity?follow` SSE subscription set in `routes.ts`) is tracked as a 1.0.x followup — for 1.0 you can observe partial failures via the DB or the `incident-reporter` warn log.

If you have custom alerting hooked into the event stream, add `recovery:degraded` to your subscription.

---

## 5. After upgrade — verify

```bash
# Hit the health endpoint
curl http://localhost:10114/api/setup/status

# Check recent migration application
sqlite3 ~/.openlander/openlander.db ".tables" | grep __drizzle_migrations
sqlite3 ~/.openlander/openlander.db "SELECT COUNT(*) FROM __drizzle_migrations;"
# Should be 6 (0000 through 0005)

# Reconcile container state — projects whose containers vanished while
# OpenLander was offline should converge to 'stopped' or 'error' within
# the 30-second container-state-reconciler interval.
```

If anything looks off, restore the backup from step 1 and open an issue with the boot logs.

---

## 6. Rollback

If the upgrade fails after step 3:

```bash
pm2 stop openlander
rm -rf ~/.openlander
mv ~/.openlander.bak-rc7-YYYYMMDD ~/.openlander
npm install -g openlander@1.0.0-rc.7   # or the rc you were on
pm2 restart openlander
```

`rc.5` and `rc.7` predate the Drizzle Kit migrator entirely — they have no `__drizzle_migrations` table and don't understand the rebuilt `ai_usage_log` / `projects` schemas. Do **not** point an old build at a `1.0.0` data dir without restoring the backup first.
