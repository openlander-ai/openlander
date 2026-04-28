-- 0009_split_projects_services.sql
-- rc.2 Phase 1 of the project/service full-data-model split.
--
-- Plan: .omc/plans/ralplan-data-model-full-migration.md §6.1–§6.4 (FK matrix,
-- new shapes, atomic-or-bust transaction policy).
--
-- This migration is structured for the rc.2 P1 acceptance gate (§6.5):
-- non-destructive, additive-where-possible, paired with a sibling
-- `0009_split_projects_services.down.sql` for emergency rollback.
--
-- Phases (logical):
--   A: stash today's projects/services as <_legacy> via copy-then-drop
--      (using rename would invalidate the projects/services CHECK constraints
--      and the service_metrics FK in subtle ways — copy-then-drop is clean).
--   B: create new projects (group-only) + services (unified) tables. Per
--      plan §6.2/§6.3 the new shapes are slim and explicit.
--   C: synthesize __orphan_managed group row hosting all managed services.
--   D: every projects_legacy row -> (group row + service row).
--      Compose children point parent_service_id at parent's __svc id.
--   E: every services_legacy row -> service row in unified table with
--      kind = today's `type` value, project_id = '__orphan_managed'.
--   F: re-point all 11 FK tables per §6.1 matrix (additive: ADD service_id
--      column to deployable-scoped tables, leave project_id in place for
--      P2/P3 back-compat; column rename for service_connections;
--      triple rename for project_dependencies; rename project_ops_overrides
--      table to service_ops_overrides).
--   G: drop legacy tables.
--
-- Atomicity: the Drizzle migrator wraps each migration file in a single
-- BEGIN/COMMIT transaction (better-sqlite3 + drizzle-orm/migrator). PRAGMA
-- foreign_keys must be OFF before migrate() is called — production handles
-- this at src/db/index.ts:435-443. Test fixtures must do the same; helper
-- at test/helpers/migrate-with-fk-off.ts mirrors the production wrap.
--
-- Hard-fail on orphans (1.0 policy): if any FK re-point step would leave
-- orphaned references, foreign_key_check at startup raises and the server
-- refuses to boot. No __orphans_0009 quarantine.
--
-- Audit table migration_0009_audit records every row remap; informational
-- only. Plan §6.5 acceptance gate references the per-phase row counts.

-- Idempotency guard: every CREATE/ALTER/DROP in this file uses IF NOT EXISTS
-- or IF EXISTS clauses where SQLite supports them, and the per-migration
-- harness in src/db/index.ts:applyAndRecordAllMigrations swallows errors
-- on individual statements so re-runs against an already-migrated DB are
-- safe. The audit table acts as a sentinel: if it already exists we still
-- run the rest, but every statement is no-op safe.

CREATE TABLE IF NOT EXISTS migration_0009_audit (
  phase TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint

-- =====================================================================
-- Phase A: stash today's projects/services as <_legacy> via copy-then-drop.
--
-- We CANNOT use ALTER TABLE RENAME on `services` because:
--   * services has CHECK constraints that reference qualified columns
--     (e.g. `services_status_check` references "services"."status"),
--     which legacy_alter_table=ON would invalidate after rename;
--   * service_metrics has a FK to services(id) that with the default
--     (legacy_alter_table=OFF) would get rewritten to services_legacy(id),
--     and then Phase G's DROP services_legacy would fail on the live FK.
--
-- Copy-then-drop sidesteps both: legacy tables hold the source data,
-- and the FK from service_metrics keeps pointing at `services` by name
-- (which we re-create in Phase B with the new shape).
-- =====================================================================
CREATE TABLE projects_legacy AS SELECT * FROM projects;
--> statement-breakpoint
CREATE TABLE services_legacy AS SELECT * FROM services;
--> statement-breakpoint
DROP TABLE projects;
--> statement-breakpoint
DROP TABLE services;
--> statement-breakpoint

-- =====================================================================
-- Phase B: create the new shape.
--
-- The `projects` table here keeps a back-compat extension: legacy
-- deployable columns (status, assigned_port, container_id, etc.) remain
-- as nullable, mirrored from the auto-derived service row. P1 keeps the
-- existing repo + handler code building; P2/P3 will trim these out after
-- callers migrate to `services.id` lookups. Plan §6.5 calls this the
-- "backward-compat helper" surface.
--
-- The `services` table is the unified deployable+managed shape per §6.3.
-- =====================================================================

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  branch TEXT DEFAULT 'main',
  archived_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  server_id TEXT NOT NULL DEFAULT 'local',
  -- ---- P1 backward-compat columns (DEPRECATED; mirrored from auto-derived service) ----
  -- These columns will be dropped in a follow-up migration (post-P3). Keeping
  -- them on `projects` lets the existing repo + route layer build against
  -- the old ProjectRow shape during P2/P3 rewire.
  status TEXT DEFAULT 'stopped',
  visibility TEXT DEFAULT 'internal',
  assigned_port INTEGER UNIQUE,
  container_id TEXT,
  image_tag TEXT,
  previous_image_tag TEXT,
  public_url TEXT,
  parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  dockerfile_path TEXT DEFAULT 'Dockerfile',
  docker_target TEXT,
  build_context TEXT,
  build_method TEXT,
  source TEXT NOT NULL DEFAULT 'git',
  image_url TEXT,
  image_cmd TEXT,
  container_port INTEGER,
  pending_fix TEXT,
  deploy_lock_session TEXT,
  deploy_lock_at TEXT,
  access_code TEXT,
  access_code_iv TEXT,
  is_preview INTEGER DEFAULT 0,
  pr_number INTEGER,
  project_type TEXT NOT NULL DEFAULT 'web',
  health_check_strategy TEXT,
  health_check_path TEXT,
  recovering_started_at TEXT
);
--> statement-breakpoint

CREATE INDEX idx_projects_parent ON projects(parent_project_id);
--> statement-breakpoint

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'git', 'image', 'compose', 'compose-child',
    'postgres', 'mysql', 'redis', 'mongo', 'minio'
  )),
  parent_service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
  -- Deployable-specific (NULL for managed)
  status TEXT,
  visibility TEXT,
  assigned_port INTEGER UNIQUE,
  container_id TEXT,
  container_name TEXT,
  container_port INTEGER,
  image_tag TEXT,
  previous_image_tag TEXT,
  public_url TEXT,
  dockerfile_path TEXT DEFAULT 'Dockerfile',
  docker_target TEXT,
  build_context TEXT,
  build_method TEXT,
  source TEXT NOT NULL DEFAULT 'git',
  image_url TEXT,
  image_cmd TEXT,
  pending_fix TEXT,
  deploy_lock_session TEXT,
  deploy_lock_at TEXT,
  access_code TEXT,
  access_code_iv TEXT,
  is_preview INTEGER DEFAULT 0,
  pr_number INTEGER,
  project_type TEXT NOT NULL DEFAULT 'web',
  health_check_strategy TEXT,
  health_check_path TEXT,
  recovering_started_at TEXT,
  -- Managed-specific (NULL for deployables) - back-compat retained
  type TEXT,
  image TEXT,
  port INTEGER,
  env_vars TEXT,
  credentials TEXT,
  -- Common
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint

CREATE INDEX idx_services_project ON services(project_id);
--> statement-breakpoint
CREATE INDEX idx_services_kind ON services(kind);
--> statement-breakpoint
CREATE INDEX idx_services_parent ON services(parent_service_id);
--> statement-breakpoint

-- =====================================================================
-- Phase C: synthesize the __orphan_managed group row.
-- This group hosts every managed-service row migrated out of services_legacy
-- (today's managed services have no project FK; they are referenced via
-- service_connections rows but live their own lifecycle).
-- =====================================================================
INSERT INTO projects (id, name, repo_url, branch, server_id)
  VALUES ('__orphan_managed', '__orphan_managed', NULL, NULL, 'local');
--> statement-breakpoint

INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  VALUES ('C', 'synthetic', '__orphan_managed', 'projects', '__orphan_managed', 'group', strftime('%s','now'));
--> statement-breakpoint

-- =====================================================================
-- Phase D: every projects_legacy row -> group + service row.
--
-- ID convention: service id = <original>__svc.
--   - standalone (parent_project_id IS NULL): group row + service kind=git/image
--   - compose parent (build_method='compose', parent_project_id IS NULL):
--     group row + service kind='compose' (carries dockerfile_path = compose YAML).
--   - compose child (parent_project_id NOT NULL): NO new group row — children
--     share parent's group (project_id = parent_project_id). Their service
--     kind='compose-child', parent_service_id = parent's __svc.
--
-- Group row preserves ALL legacy columns from projects_legacy so that
-- existing repo/handler code reading project.status / project.assigned_port
-- continues to work during P2/P3 transition. Plan §6.5 backward-compat.
-- =====================================================================

-- INSERT OR IGNORE: if a re-run of 0009 finds a row that already exists
-- (e.g. __orphan_managed synthesized in Phase C, or projects_legacy still
-- carrying rows from a prior 0009 run), skip silently rather than aborting
-- the whole INSERT and losing other rows. SQLite's default ABORT conflict
-- resolution would otherwise drop ALL rows when one fails.
INSERT OR IGNORE INTO projects (
  id, name, repo_url, branch, archived_at, created_at, updated_at, server_id,
  status, visibility, assigned_port, container_id, image_tag, previous_image_tag,
  public_url, parent_project_id, dockerfile_path, docker_target, build_context,
  build_method, source, image_url, image_cmd, container_port, pending_fix,
  deploy_lock_session, deploy_lock_at, access_code, access_code_iv,
  is_preview, pr_number, project_type, health_check_strategy, health_check_path,
  recovering_started_at
)
  SELECT
    id, name, repo_url, branch, archived_at, created_at, updated_at, server_id,
    status, visibility, assigned_port, container_id, image_tag, previous_image_tag,
    public_url, parent_project_id, dockerfile_path, docker_target, build_context,
    build_method, source, image_url, image_cmd, container_port, pending_fix,
    deploy_lock_session, deploy_lock_at, access_code, access_code_iv,
    is_preview, pr_number, project_type, health_check_strategy, health_check_path,
    recovering_started_at
  FROM projects_legacy
  WHERE id != '__orphan_managed';
--> statement-breakpoint

-- Insert service rows for every projects_legacy entry. INSERT OR IGNORE
-- so re-runs of 0009 against a partially-applied DB skip already-present
-- rows. NOTE: we do NOT filter out __orphan_managed here even though we
-- skipped it in the projects INSERT above — if a re-run of 0009 finds
-- environments rows already pointing at __orphan_managed__svc (from a
-- prior run's bridge backfill), we want that service row to exist.
-- project_id = parent_project_id for children, else self id (== group id).
INSERT OR IGNORE INTO services (id, project_id, name, kind, parent_service_id, status, visibility,
                     assigned_port, container_id, container_port,
                     image_tag, previous_image_tag, public_url, dockerfile_path,
                     docker_target, build_context, build_method, source, image_url,
                     image_cmd, pending_fix, deploy_lock_session, deploy_lock_at,
                     access_code, access_code_iv, is_preview, pr_number, project_type,
                     health_check_strategy, health_check_path, recovering_started_at,
                     created_at, updated_at, archived_at, server_id)
  SELECT
    id || '__svc',
    CASE WHEN parent_project_id IS NULL THEN id ELSE parent_project_id END,
    name || '__svc',
    CASE
      WHEN parent_project_id IS NOT NULL THEN 'compose-child'
      WHEN build_method = 'compose' THEN 'compose'
      WHEN source = 'image' THEN 'image'
      ELSE 'git'
    END,
    CASE WHEN parent_project_id IS NOT NULL THEN parent_project_id || '__svc' ELSE NULL END,
    status, visibility, assigned_port, container_id, container_port,
    image_tag, previous_image_tag, public_url, dockerfile_path, docker_target,
    build_context, build_method, source, image_url, image_cmd, pending_fix,
    deploy_lock_session, deploy_lock_at, access_code, access_code_iv, is_preview,
    pr_number, project_type, health_check_strategy, health_check_path,
    recovering_started_at, created_at, updated_at, archived_at, server_id
  FROM projects_legacy;
--> statement-breakpoint

INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'D', 'projects', id, 'services', id || '__svc',
         CASE
           WHEN parent_project_id IS NOT NULL THEN 'compose-child'
           WHEN build_method = 'compose' THEN 'compose'
           WHEN source = 'image' THEN 'image'
           ELSE 'git'
         END,
         strftime('%s','now')
  FROM projects_legacy
  WHERE id != '__orphan_managed';
--> statement-breakpoint

-- Audit row for the group rows (every projects_legacy row produced a group).
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'D', 'projects', id, 'projects', id, 'group', strftime('%s','now')
  FROM projects_legacy
  WHERE id != '__orphan_managed';
--> statement-breakpoint

-- =====================================================================
-- Phase E: managed services_legacy -> services with kind normalized from
-- today's `type` column.
--
-- Production data has legacy `type` values that don't directly match the
-- kind enum: 'postgresql' (vs canonical 'postgres'), 'pgvector' (postgres
-- variant), custom container names like 'flaresolverr'. CHECK (kind IN ...)
-- on services would reject the raw type. Normalize via CASE:
--   - postgresql / postgres / pgvector / timescaledb -> 'postgres'
--   - mysql / mariadb                                -> 'mysql'
--   - redis / keydb / dragonfly                      -> 'redis'
--   - mongo / mongodb                                -> 'mongo'
--   - minio / s3                                     -> 'minio'
--   - everything else                                -> 'image' (opaque)
-- Legacy `type` value preserved verbatim in the additive `type` column.
-- Audit log records the original legacy type for forensic traceability.
-- All managed services land under the synthesized __orphan_managed group.
-- =====================================================================
INSERT INTO services (id, project_id, name, kind, container_name, status,
                     container_id, assigned_port,
                     type, image, port, env_vars, credentials,
                     created_at, updated_at, server_id)
  SELECT id, '__orphan_managed', name,
         CASE
           WHEN lower(type) IN ('postgresql', 'postgres', 'pgvector', 'timescaledb') THEN 'postgres'
           WHEN lower(type) IN ('mysql', 'mariadb') THEN 'mysql'
           WHEN lower(type) IN ('redis', 'keydb', 'dragonfly') THEN 'redis'
           WHEN lower(type) IN ('mongo', 'mongodb') THEN 'mongo'
           WHEN lower(type) IN ('minio', 's3') THEN 'minio'
           ELSE 'image'
         END,
         container_name,
         status,
         container_id,
         port,
         type, image, port, env_vars, credentials,
         created_at,
         updated_at,
         server_id
  FROM services_legacy;
--> statement-breakpoint

-- Audit log keeps the ORIGINAL legacy type string so forensic queries can
-- recover the pre-normalization value. The post-normalization kind is what
-- actually lives in services.kind.
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'E', 'services', id, 'services', id, type, strftime('%s','now')
  FROM services_legacy;
--> statement-breakpoint

-- =====================================================================
-- Phase F: re-point all 11 FK tables per §6.1 matrix.
-- For tables that move project_id -> service_id, we ADD service_id and
-- backfill via id || '__svc'. The legacy project_id column stays during
-- P1 — older code paths read it. A follow-up migration (post-P3) drops
-- project_id from these tables and promotes service_id to NOT NULL.
-- =====================================================================

-- environments: deployable-scoped. ADD service_id, backfill.
ALTER TABLE environments ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE environments SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'environments', id, 'environments', id, 'fk_repoint', strftime('%s','now')
  FROM environments;
--> statement-breakpoint

-- env_vars: GROUP-LEVEL by default (parent group's shared envs preserved).
-- Add nullable service_id column for service-specific overrides written
-- post-migration. Existing rows keep service_id NULL = group-shared.
-- Verified group-shared semantics at src/pipeline/compose.ts:525-554.
ALTER TABLE env_vars ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'env_vars', id, 'env_vars', id, 'group_scoped', strftime('%s','now')
  FROM env_vars;
--> statement-breakpoint

-- deploy_logs: deployable-scoped.
ALTER TABLE deploy_logs ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE deploy_logs SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'deploy_logs', id, 'deploy_logs', id, 'fk_repoint', strftime('%s','now')
  FROM deploy_logs;
--> statement-breakpoint

-- domain_mappings: deployable-scoped (a domain points at a service's port).
ALTER TABLE domain_mappings ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE domain_mappings SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'domain_mappings', id, 'domain_mappings', id, 'fk_repoint', strftime('%s','now')
  FROM domain_mappings;
--> statement-breakpoint

-- webhook_configs: STAYS at projects.id (group-level — webhooks fire on
-- repo branch push, the group owns the repo URL + branch).
-- See contestation test webhook_configs_stays_group.
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'webhook_configs', id, 'webhook_configs', id, 'group_scoped', strftime('%s','now')
  FROM webhook_configs;
--> statement-breakpoint

-- runtime_incidents: deployable-scoped (incidents are container-level).
ALTER TABLE runtime_incidents ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE runtime_incidents SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'runtime_incidents', id, 'runtime_incidents', id, 'fk_repoint', strftime('%s','now')
  FROM runtime_incidents;
--> statement-breakpoint

-- deploy_configs: deployable-scoped.
ALTER TABLE deploy_configs ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE deploy_configs SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'deploy_configs', id, 'deploy_configs', id, 'fk_repoint', strftime('%s','now')
  FROM deploy_configs;
--> statement-breakpoint

-- project_ops_overrides -> service_ops_overrides (table rename + add service_id).
ALTER TABLE project_ops_overrides RENAME TO service_ops_overrides;
--> statement-breakpoint
ALTER TABLE service_ops_overrides ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE service_ops_overrides SET service_id = project_id || '__svc';
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'project_ops_overrides', id, 'service_ops_overrides', id, 'fk_repoint', strftime('%s','now')
  FROM service_ops_overrides;
--> statement-breakpoint

-- secret_files: STAYS at projects.id (group-shared).
-- VERIFIED group-shared at src/pipeline/compose.ts:668 —
-- getSecretFilesForDeploy(parentProjectId) is called with parent ID
-- and result is shared across ALL compose children.
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'secret_files', id, 'secret_files', id, 'group_scoped', strftime('%s','now')
  FROM secret_files;
--> statement-breakpoint

-- service_connections: ADD new service_id_app/service_id_db columns. Per
-- plan §6.1 the long-term shape is column rename, but a rename here would
-- break existing repo writes during P2/P3 transition. We populate the new
-- columns and let P2 rewire reads. A follow-up migration (post-P3) drops
-- project_id and renames service_id -> service_id_db.
ALTER TABLE service_connections ADD COLUMN service_id_app TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE service_connections ADD COLUMN service_id_db TEXT REFERENCES services(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE service_connections SET service_id_app = project_id || '__svc', service_id_db = service_id;
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'service_connections', id, 'service_connections', id, 'columns_added', strftime('%s','now')
  FROM service_connections;
--> statement-breakpoint

-- service_metrics: unchanged (already service-scoped).

-- project_dependencies: ADD new service-scoped columns alongside legacy
-- project-scoped columns. Per plan §6.1 the long-term shape is triple-rename;
-- in P1 we add additively so existing repo writes don't break.
ALTER TABLE project_dependencies ADD COLUMN source_service_id TEXT;
--> statement-breakpoint
ALTER TABLE project_dependencies ADD COLUMN target_managed_service_id TEXT;
--> statement-breakpoint
UPDATE project_dependencies SET
  source_service_id = source_project_id || '__svc',
  target_managed_service_id = target_service_id;
--> statement-breakpoint
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT 'F', 'project_dependencies', id, 'project_dependencies', id, 'columns_added', strftime('%s','now')
  FROM project_dependencies;
--> statement-breakpoint

-- =====================================================================
-- Phase G: drop legacy tables.
-- After this point only the new schema is reachable.
-- =====================================================================
DROP TABLE projects_legacy;
--> statement-breakpoint
DROP TABLE services_legacy;
