# Upgrading to OpenLander 1.0

OpenLander 1.0 ships the data-model split (project → group, service → deployable). A one-time SQLite migration (`0009_split_projects_services`) runs at first boot.

**Estimated downtime**: <30 seconds for typical Mac mini installs (1-50 projects). Migration is atomic-or-bust — the DB is either fully on the new schema or fully on the old.

## Before you upgrade

### 1. Verify your current version

```bash
~/OpenLander/openlander --version  # or whatever your install path is
# Expected: 1.0.0-rc.1 OR earlier (rc.0/rc.x)
```

If you skipped rc.1, that's fine — rc.2 (= 1.0 GA) handles both rc.1 and pre-rc.1 schemas in the same migration.

### 2. Back up your database

The server creates an automatic backup at first boot:

```
~/.openlander/openlander.db.pre-1.0-fullsplit.bak
```

But for safety, **make your own copy first**:

```bash
cp ~/.openlander/openlander.db ~/.openlander/openlander.db.manual-pre-1.0.bak
```

Verify it's a valid SQLite file:

```bash
sqlite3 ~/.openlander/openlander.db.manual-pre-1.0.bak '.tables' | head -3
# Should list: projects, services, env_vars, ...
```

### 3. Stop the running server

```bash
pm2 stop openlander    # or your supervisor's stop command
```

## Upgrade

### 4. Pull and rebuild

```bash
cd ~/path/to/OpenLander
git pull
npm ci
npm run build
```

### 5. Start — migration auto-runs

```bash
pm2 start openlander
pm2 logs openlander --lines 80
```

You should see, in order:

```
{"level":30,...,"module":"db-migration","msg":"bridging legacy database"}
{"level":30,...,"module":"db-migration","msg":"legacy bridge complete"}
{"level":30,...,"module":"db-migration","msg":"applying migration 0009_split_projects_services"}
{"level":30,...,"module":"db-migration","msg":"migration 0009 applied; PRAGMA foreign_key_check returned 0 violations"}
{"level":30,...,"module":"web","msg":"OpenLander v1.0.0 listening"}
{"level":30,...,"module":"web","phase":"1.0","scope":"GA-full-split","msg":"[data-model-alignment] phase=1.0 (GA-full-split)"}
```

### 6. Verify

After the boot banner appears, sanity-check:

```bash
# Group + services list (canonical)
curl -s http://localhost:10114/api/projects | jq '.[0]'
# Should return objects with: id, name, repo_url, branch (group fields). NOT status/assigned_port.

# Deployables under a group
curl -s http://localhost:10114/api/projects/<projectId>/services | jq '.'
# Returns the deployable services for that group, each with `kind` field.

# Managed services unchanged
curl -s http://localhost:10114/api/services | jq '.[0].name, .[0].kind'
# kind should be one of: postgres, mysql, redis, mongo, minio
```

If you have a project group from before, its deployable services will appear in `/api/projects/:p/services` automatically. The migration assigns service IDs as `<projectId>__svc` for legacy single-project deployables.

## If migration fails

The server **refuses to start** if:

- The pre-migration backup file write fails (disk full, permission error)
- Migration `0009` aborts (FK violation, disk space exhaustion mid-transaction)
- `PRAGMA foreign_key_check` returns non-zero violations after migration

Look for these signals in the log:

```
{"level":50,...,"module":"db-migration","msg":"migration 0009 aborted: <reason>"}
ERROR: migration failed; restore from ~/.openlander/openlander.db.pre-1.0-fullsplit.bak
```

### Rollback procedure

```bash
# 1. Stop the failing server
pm2 stop openlander

# 2. Restore from backup
cp ~/.openlander/openlander.db.pre-1.0-fullsplit.bak ~/.openlander/openlander.db

# 3. Downgrade the binary
cd ~/path/to/OpenLander
git checkout v1.0.0-rc.1  # or whichever version you ran before
npm ci && npm run build

# 4. Restart
pm2 start openlander
pm2 logs openlander --lines 30
```

You're now back on rc.1 (or whatever you were running). File a bug report with the migration log:

```bash
pm2 logs openlander --lines 200 --nostream > /tmp/migration-fail.log
```

Issue: https://github.com/openlander-ai/OpenLander/issues/new

## What changed for end users

### URLs

- **Service detail**: `/services/:id?project=:p` still works (308 redirect to `/projects/:p/services/:s`). Old bookmarks land on the right page.
- **Managed services**: `/managed-services/:id` still works (308 redirect to `/projects/__orphan_managed/services/:s`).
- **Direct API calls**: `/api/projects/:id/<verb>` still work; the response carries an `X-Deprecated-Endpoint` header pointing at the canonical replacement. Removed in 2.0.

### MCP composite tools

The `openlander_service` composite changed meaning between rc.1 and 1.0 GA:

- **Before 1.0** (and during rc.1): `openlander_service` covers managed databases (Postgres / MySQL / Redis / Mongo / MinIO).
- **At 1.0 GA**: `openlander_service` covers **deployables** (your apps). Today's managed-only behavior moved to `openlander_managed_service`.

If you have MCP scripts calling `openlander_service.create_service({type: 'postgres', ...})` (managed flavor), they keep working — the dispatcher detects the managed-flavor params and routes to `openlander_managed_service` automatically with a one-time deprecation warning per session.

If you have scripts calling `openlander_project.stop_project(...)` (legacy), they keep working — the deprecation warning logs once per session, removed in 2.0.

**Recommended** for cleanest scripts: rename your calls now.

- `openlander_project.stop_project` → `openlander_service.stop_service`
- `openlander_service.create_service({type: 'postgres'})` → `openlander_managed_service.create_service`
- `openlander_project.redeploy_project` → `openlander_service.deploy_service`

The `vocabulary-audit.test.ts` lint guard in the repo enforces the alias map's correctness so `*_service` aliases never drift out of sync with `*_project` actions.

## What changed for downstream tooling

### REST consumers

Read the `X-Deprecated-Endpoint` response header. It points at the canonical replacement, e.g.:

```
X-Deprecated-Endpoint: use METHOD /api/projects/:p/services/:s/<verb> since=1.0-rc.1 removed_in=2.0
```

### Database consumers (if any)

Direct SQLite reads against the DB will see the new shape:

- `projects.id, name, repo_url, branch` — group columns only (post follow-up migration; rc.2/GA keeps legacy columns side-by-side for additive transition).
- `services.id, project_id (FK), name, kind` + per-kind columns — unified shape.
- `services.parent_service_id` — compose hierarchy. NULL for non-compose-children.

The legacy column drop migration (`0010_drop_legacy_split_columns`) ships in a 1.0.x patch release after the integration sweep settles. Until then, the legacy columns are still present but should be considered deprecated for direct reads.

## See also

- Full ralplan + ADR: `.omc/plans/ralplan-data-model-full-migration.md`
- Debt ledger: `.omc/plans/data-model-debt.md`
- Design vocabulary spec: `docs/design/v1.0/GUIDE-01-IA-principles.md` §4
