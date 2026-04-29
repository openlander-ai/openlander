-- 0012_complete_schema_split.sql
-- =====================================================================
-- 1.0 GA migration — final structural cleanup of the project/service split.
--
-- Plan: .omc/plans/ralplan-data-model-A-completion.md §"PR 5 — Migration 0012"
-- ADR: same file §"UNIQUE-shape per repointed table" + §"Deploy-lock relocation"
--
-- Phases (literal — see Phase H audit-row breakdown for the count):
--   A. Pre-flight assertions. ABORT (raise via ABORT statement) if any
--      pre-existing data violates the new UNIQUE shape on the target tables.
--   B. Repoint 6 per-deployable FK tables: environments, deploy_configs,
--      deploy_logs, domain_mappings, runtime_incidents, service_ops_overrides.
--      Table-rebuild pattern (CREATE _new + INSERT SELECT + DROP + RENAME).
--      Per-table FK now targets services(id) instead of projects(id).
--   C. Drop services back-compat columns (type, image, port, env_vars,
--      deploy_lock_session, deploy_lock_at). credentials STAYS through 1.0.
--   D. Repoint service_connections via table-rebuild — rename
--      service_id_app/db → service_id_consumer/provider, drop legacy
--      project_id + service_id.
--   E. Repoint project_dependencies via table-rebuild — promote
--      source_service_id, rename target_managed_service_id → target_service_id,
--      drop legacy source_project_id + target_project_id + target_service_id
--      (the legacy column at the same name is replaced by the canonical one).
--   F. Delete reconstructed compose-child rows from `projects` (the 0011
--      backfill is no longer needed because the per-deployable FK targets
--      moved to services.id in Phase B).
--   G. Drop 25 deprecated columns from `projects`. Keep 8 group cols + 2
--      deploy_lock cols = 10 total post-G.
--   H. Insert 45 audit rows recording every column drop, FK repoint,
--      UNIQUE rebuild, and INDEX repoint.
--
-- Atomicity: Drizzle's better-sqlite3 migrator wraps each migration file in
-- a single BEGIN/COMMIT transaction. PRAGMA foreign_keys must be OFF before
-- migrate() — production handles this at src/db/index.ts:448. The wrapper
-- in src/db/index.ts also performs PRAGMA foreign_key_check post-migrate
-- and aborts startup if any orphans surface.
--
-- Backup: src/db/index.ts:bridgeLegacyDatabase / pre-migration prelude
-- writes ~/.openlander/openlander.db.pre-1.0-a-completion.bak BEFORE this
-- migration runs. Backup-or-bust: if backup write fails, the prelude throws
-- and Drizzle never starts the migration.

-- =====================================================================
-- Phase A — Pre-flight assertions.
--
-- Two assertion groups per the temp-table-trigger pattern:
--   A.1 NULL-orphan assertions: any row with a NULL FK that would be
--       silently dropped by Phase B's INSERT…SELECT → ABORT so no data
--       is lost without operator knowledge.
--   A.2 UNIQUE-shape assertions: duplicate rows on the new UNIQUE keys
--       that Phase B will enforce → ABORT before the table-rebuild fails.
--
-- SQLite's RAISE(ABORT, ...) is only valid inside a trigger body, so we
-- use a temp-table-trigger pattern: BEFORE INSERT on _0012_assert with a
-- WHEN clause that evaluates the violation predicate and RAISEs if true.
-- The INSERT fires all registered triggers at once; on a clean DB every
-- trigger's WHEN is false and the INSERT proceeds harmlessly.
-- Cleanup drops all temp objects at the end of Phase A.
-- =====================================================================
CREATE TEMP TABLE _0012_assert (probe INTEGER);
--> statement-breakpoint

-- ---- A.1 NULL-orphan assertions (data-safety) ----------------------

-- environments: any row with NULL service_id would be silently dropped
-- during the Phase B rebuild INSERT…WHERE service_id IS NOT NULL.
CREATE TEMP TRIGGER _0012_assert_environments_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM environments WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: environments has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- deploy_configs: same pattern.
CREATE TEMP TRIGGER _0012_assert_deploy_configs_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM deploy_configs WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: deploy_configs has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- deploy_logs: same pattern.
CREATE TEMP TRIGGER _0012_assert_deploy_logs_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM deploy_logs WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: deploy_logs has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- domain_mappings: same pattern.
CREATE TEMP TRIGGER _0012_assert_domain_mappings_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM domain_mappings WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: domain_mappings has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- runtime_incidents: same pattern.
CREATE TEMP TRIGGER _0012_assert_runtime_incidents_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM runtime_incidents WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: runtime_incidents has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- service_ops_overrides: same pattern.
CREATE TEMP TRIGGER _0012_assert_service_ops_overrides_null_service_id
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM service_ops_overrides WHERE service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: service_ops_overrides has rows with NULL service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- service_connections: Phase D drops rows where either FK is NULL.
CREATE TEMP TRIGGER _0012_assert_service_connections_null_fk
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM service_connections WHERE service_id_app IS NULL OR service_id_db IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: service_connections has rows with NULL service_id_app or service_id_db; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- project_dependencies: Phase E drops rows where source_service_id is NULL.
CREATE TEMP TRIGGER _0012_assert_project_dependencies_null_source
BEFORE INSERT ON _0012_assert
WHEN EXISTS (SELECT 1 FROM project_dependencies WHERE source_service_id IS NULL LIMIT 1)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: project_dependencies has rows with NULL source_service_id; manual data cleanup required before running 0012');
END;
--> statement-breakpoint

-- ---- A.2 UNIQUE-shape assertions -----------------------------------

CREATE TEMP TRIGGER _0012_assert_environments_unique
BEFORE INSERT ON _0012_assert
WHEN EXISTS (
  SELECT 1 FROM (
    SELECT service_id, type, COUNT(*) c
    FROM environments
    WHERE service_id IS NOT NULL
    GROUP BY service_id, type
    HAVING COUNT(*) > 1
  )
)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: environments(service_id, type) UNIQUE-shape pre-flight violated');
END;
--> statement-breakpoint

CREATE TEMP TRIGGER _0012_assert_deploy_configs_unique
BEFORE INSERT ON _0012_assert
WHEN EXISTS (
  SELECT 1 FROM (
    SELECT service_id, COUNT(*) c
    FROM deploy_configs
    WHERE service_id IS NOT NULL
    GROUP BY service_id
    HAVING COUNT(*) > 1
  )
)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: deploy_configs(service_id) UNIQUE-shape pre-flight violated');
END;
--> statement-breakpoint

CREATE TEMP TRIGGER _0012_assert_service_ops_overrides_unique
BEFORE INSERT ON _0012_assert
WHEN EXISTS (
  SELECT 1 FROM (
    SELECT service_id, COUNT(*) c
    FROM service_ops_overrides
    WHERE service_id IS NOT NULL
    GROUP BY service_id
    HAVING COUNT(*) > 1
  )
)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: service_ops_overrides(service_id) UNIQUE-shape pre-flight violated');
END;
--> statement-breakpoint

CREATE TEMP TRIGGER _0012_assert_service_connections_unique
BEFORE INSERT ON _0012_assert
WHEN EXISTS (
  SELECT 1 FROM (
    SELECT service_id_app, service_id_db, COUNT(*) c
    FROM service_connections
    WHERE service_id_app IS NOT NULL AND service_id_db IS NOT NULL
    GROUP BY service_id_app, service_id_db
    HAVING COUNT(*) > 1
  )
)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: service_connections(consumer, provider) UNIQUE-shape pre-flight violated');
END;
--> statement-breakpoint

CREATE TEMP TRIGGER _0012_assert_domain_mappings_unique
BEFORE INSERT ON _0012_assert
WHEN EXISTS (
  SELECT 1 FROM (
    SELECT domain, COUNT(*) c
    FROM domain_mappings
    GROUP BY domain
    HAVING COUNT(*) > 1
  )
)
BEGIN
  SELECT RAISE(ABORT, '0012 phase A: domain_mappings(domain) UNIQUE-shape pre-flight violated');
END;
--> statement-breakpoint

-- All triggers fire on this single INSERT. If any WHEN is true the
-- migration aborts here with a descriptive message. On a clean DB the
-- INSERT proceeds harmlessly and all temp objects are cleaned up below.
INSERT INTO _0012_assert (probe) VALUES (1);
--> statement-breakpoint

DROP TRIGGER _0012_assert_environments_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_deploy_configs_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_deploy_logs_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_domain_mappings_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_runtime_incidents_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_service_ops_overrides_null_service_id;
--> statement-breakpoint
DROP TRIGGER _0012_assert_service_connections_null_fk;
--> statement-breakpoint
DROP TRIGGER _0012_assert_project_dependencies_null_source;
--> statement-breakpoint
DROP TRIGGER _0012_assert_environments_unique;
--> statement-breakpoint
DROP TRIGGER _0012_assert_deploy_configs_unique;
--> statement-breakpoint
DROP TRIGGER _0012_assert_service_ops_overrides_unique;
--> statement-breakpoint
DROP TRIGGER _0012_assert_service_connections_unique;
--> statement-breakpoint
DROP TRIGGER _0012_assert_domain_mappings_unique;
--> statement-breakpoint
DROP TABLE _0012_assert;
--> statement-breakpoint

-- =====================================================================
-- Phase B — Repoint 6 per-deployable FK tables (table-rebuild pattern).
--
-- Each table's FK on project_id → projects(id) is replaced with a NOT NULL
-- service_id → services(id). Indices and UNIQUE shapes per ADR table.
-- =====================================================================

-- environments rebuild
CREATE TABLE environments_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('production', 'development')),
  branch TEXT NOT NULL DEFAULT 'main',
  status TEXT DEFAULT 'idle' CHECK (status IN ('running','stopped','building','error','idle')),
  assigned_port INTEGER UNIQUE,
  container_id TEXT,
  image_tag TEXT,
  previous_image_tag TEXT,
  public_url TEXT,
  container_port INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint
INSERT INTO environments_new (
  id, service_id, type, branch, status, assigned_port,
  container_id, image_tag, previous_image_tag, public_url, container_port,
  created_at, updated_at, server_id
)
SELECT id, service_id, type, branch, status, assigned_port,
  container_id, image_tag, previous_image_tag, public_url, container_port,
  created_at, updated_at, server_id
FROM environments;
--> statement-breakpoint
DROP TABLE environments;
--> statement-breakpoint
ALTER TABLE environments_new RENAME TO environments;
--> statement-breakpoint
CREATE UNIQUE INDEX environments_service_type_unique ON environments(service_id, type);
--> statement-breakpoint
CREATE INDEX idx_environments_service ON environments(service_id);
--> statement-breakpoint

-- deploy_configs rebuild
CREATE TABLE deploy_configs_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO deploy_configs_new (id, service_id, config_json, config_version, created_at, updated_at)
SELECT id, service_id, config_json, config_version, created_at, updated_at
FROM deploy_configs;
--> statement-breakpoint
DROP TABLE deploy_configs;
--> statement-breakpoint
ALTER TABLE deploy_configs_new RENAME TO deploy_configs;
--> statement-breakpoint
CREATE INDEX idx_deploy_configs_service ON deploy_configs(service_id);
--> statement-breakpoint

-- deploy_logs rebuild (no UNIQUE, INDEX repoint only)
CREATE TABLE deploy_logs_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('success', 'failed', 'cancelled')),
  trigger_source TEXT CHECK (trigger_source IN ('chat', 'webhook', 'api')),
  trigger_detail TEXT,
  commit_sha TEXT,
  commit_message TEXT,
  build_log TEXT,
  runtime_log TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint
INSERT INTO deploy_logs_new (
  id, service_id, environment_id, status, trigger_source, trigger_detail,
  commit_sha, commit_message, build_log, runtime_log, duration_ms,
  created_at, server_id
)
SELECT id, service_id, environment_id, status, trigger_source, trigger_detail,
  commit_sha, commit_message, build_log, runtime_log, duration_ms,
  created_at, server_id
FROM deploy_logs;
--> statement-breakpoint
DROP TABLE deploy_logs;
--> statement-breakpoint
ALTER TABLE deploy_logs_new RENAME TO deploy_logs;
--> statement-breakpoint
CREATE INDEX idx_deploy_logs_service ON deploy_logs(service_id);
--> statement-breakpoint
CREATE INDEX idx_deploy_logs_environment ON deploy_logs(environment_id);
--> statement-breakpoint

-- domain_mappings rebuild
CREATE TABLE domain_mappings_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE,
  cloudflare_zone_id TEXT,
  cloudflare_dns_record_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'error')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO domain_mappings_new (
  id, service_id, domain, cloudflare_zone_id, cloudflare_dns_record_id, status, created_at
)
SELECT id, service_id, domain, cloudflare_zone_id, cloudflare_dns_record_id, status, created_at
FROM domain_mappings;
--> statement-breakpoint
DROP TABLE domain_mappings;
--> statement-breakpoint
ALTER TABLE domain_mappings_new RENAME TO domain_mappings;
--> statement-breakpoint
CREATE INDEX idx_domain_mappings_service ON domain_mappings(service_id);
--> statement-breakpoint

-- runtime_incidents rebuild
CREATE TABLE runtime_incidents_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id),
  category TEXT NOT NULL,
  exit_code INTEGER,
  error_snippet TEXT,
  container_image TEXT,
  container_uptime_ms INTEGER,
  restart_count INTEGER,
  diagnosis TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint
INSERT INTO runtime_incidents_new (
  id, service_id, environment_id, category, exit_code, error_snippet,
  container_image, container_uptime_ms, restart_count, diagnosis,
  resolved, resolved_at, created_at, server_id
)
SELECT id, service_id, environment_id, category, exit_code, error_snippet,
  container_image, container_uptime_ms, restart_count, diagnosis,
  resolved, resolved_at, created_at, server_id
FROM runtime_incidents;
--> statement-breakpoint
DROP TABLE runtime_incidents;
--> statement-breakpoint
ALTER TABLE runtime_incidents_new RENAME TO runtime_incidents;
--> statement-breakpoint
CREATE INDEX idx_runtime_incidents_service ON runtime_incidents(service_id);
--> statement-breakpoint
CREATE INDEX idx_runtime_incidents_resolved ON runtime_incidents(resolved);
--> statement-breakpoint

-- service_ops_overrides rebuild
CREATE TABLE service_ops_overrides_new (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
  overrides_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO service_ops_overrides_new (id, service_id, overrides_json, created_at, updated_at)
SELECT id, service_id, overrides_json, created_at, updated_at
FROM service_ops_overrides;
--> statement-breakpoint
DROP TABLE service_ops_overrides;
--> statement-breakpoint
ALTER TABLE service_ops_overrides_new RENAME TO service_ops_overrides;
--> statement-breakpoint
CREATE INDEX idx_service_ops_overrides_service ON service_ops_overrides(service_id);
--> statement-breakpoint

-- =====================================================================
-- Phase C — Drop services back-compat columns.
-- credentials STAYS through 1.0 per ADR §"services legacy column rename".
--
-- idx_services_type was created in 0000 on the original services table.
-- If 0009's DROP TABLE services was skipped or the index survived via
-- any path, SQLite will reject DROP COLUMN type with an "error in index"
-- message. Drop it defensively before the column drop.
-- =====================================================================
DROP INDEX IF EXISTS idx_services_type;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN type;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN image;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN port;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN env_vars;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN deploy_lock_session;
--> statement-breakpoint
ALTER TABLE services DROP COLUMN deploy_lock_at;
--> statement-breakpoint

-- =====================================================================
-- Phase D — Repoint service_connections (table-rebuild).
-- Rename service_id_app/db → service_id_consumer/provider; drop legacy
-- project_id + service_id.
-- =====================================================================
CREATE TABLE service_connections_new (
  id TEXT PRIMARY KEY,
  service_id_consumer TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  service_id_provider TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
  auto_injected_env_keys TEXT,
  created_at TEXT NOT NULL,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint
INSERT INTO service_connections_new (
  id, service_id_consumer, service_id_provider, environment_id,
  auto_injected_env_keys, created_at, server_id
)
SELECT id, service_id_app, service_id_db, environment_id,
  auto_injected_env_keys, created_at, server_id
FROM service_connections;
--> statement-breakpoint
DROP TABLE service_connections;
--> statement-breakpoint
ALTER TABLE service_connections_new RENAME TO service_connections;
--> statement-breakpoint
CREATE UNIQUE INDEX service_connections_consumer_provider_idx
  ON service_connections(service_id_consumer, service_id_provider);
--> statement-breakpoint
CREATE INDEX idx_service_connections_consumer ON service_connections(service_id_consumer);
--> statement-breakpoint
CREATE INDEX idx_service_connections_provider ON service_connections(service_id_provider);
--> statement-breakpoint

-- =====================================================================
-- Phase E — Repoint project_dependencies (table-rebuild).
-- Promote source_service_id; rename target_managed_service_id →
-- target_service_id; drop legacy source_project_id, target_project_id,
-- and the OLD target_service_id column (which the schema kept additively
-- in 0009 alongside target_managed_service_id).
-- =====================================================================
CREATE TABLE project_dependencies_new (
  id TEXT PRIMARY KEY NOT NULL,
  source_service_id TEXT NOT NULL,
  target_service_id TEXT,
  dependency_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (dependency_type IN ('database', 'api', 'cache', 'queue', 'storage', 'custom')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('auto', 'manual')),
  created_at TEXT NOT NULL DEFAULT ''
);
--> statement-breakpoint
INSERT INTO project_dependencies_new (
  id, source_service_id, target_service_id, dependency_type, source, created_at
)
SELECT id, source_service_id, target_managed_service_id, dependency_type, source, created_at
FROM project_dependencies;
--> statement-breakpoint
DROP TABLE project_dependencies;
--> statement-breakpoint
ALTER TABLE project_dependencies_new RENAME TO project_dependencies;
--> statement-breakpoint
CREATE INDEX idx_project_dependencies_source ON project_dependencies(source_service_id);
--> statement-breakpoint
CREATE INDEX idx_project_dependencies_target_service ON project_dependencies(target_service_id);
--> statement-breakpoint

-- =====================================================================
-- Phase F — Delete reconstructed compose-child rows from `projects`.
-- These were inserted by 0011 to satisfy legacy per-deployable FK
-- constraints. After Phase B repointed those FKs to services(id), the
-- compose-child rows in `projects` are no longer referenced and can be
-- deleted before Phase G drops parent_project_id.
-- =====================================================================
DELETE FROM projects WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed';
--> statement-breakpoint

-- =====================================================================
-- Phase G — Drop 25 deprecated columns from `projects`.
-- Final shape: id, name, repo_url, branch, archived_at, created_at,
-- updated_at, server_id, deploy_lock_session, deploy_lock_at = 10 cols.
-- (deploy_lock_session/deploy_lock_at STAY per ADR §"Deploy-lock relocation".)
--
-- Table-rebuild pattern required: projects has a UNIQUE index on
-- assigned_port and named CHECK constraints on status/visibility/
-- build_method/is_preview/project_type/health_check_strategy/source —
-- SQLite rejects ALTER TABLE DROP COLUMN on any column with an index or
-- named constraint referencing it.  DROP TABLE removes all of them.
-- =====================================================================
CREATE TABLE projects_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT,
  branch TEXT DEFAULT 'main',
  archived_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  server_id TEXT NOT NULL DEFAULT 'local',
  deploy_lock_session TEXT,
  deploy_lock_at TEXT
);
--> statement-breakpoint
INSERT INTO projects_new (
  id, name, repo_url, branch, archived_at,
  created_at, updated_at, server_id,
  deploy_lock_session, deploy_lock_at
)
SELECT
  id, name, repo_url, branch, archived_at,
  created_at, updated_at, server_id,
  deploy_lock_session, deploy_lock_at
FROM projects;
--> statement-breakpoint
DROP TABLE projects;
--> statement-breakpoint
ALTER TABLE projects_new RENAME TO projects;
--> statement-breakpoint
CREATE UNIQUE INDEX projects_name_unique ON projects(name);
--> statement-breakpoint

-- =====================================================================
-- Phase H — Audit log entries (45 rows total).
-- =====================================================================

-- Phase H.1: 25 column-dropped audit rows for projects
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at) VALUES
  ('0012-G', 'projects', 'parent_project_id',         'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'status',                    'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'visibility',                'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'assigned_port',             'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'container_id',              'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'container_port',            'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'image_tag',                 'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'previous_image_tag',        'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'public_url',                'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'dockerfile_path',           'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'docker_target',             'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'build_context',             'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'build_method',              'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'source',                    'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'image_url',                 'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'image_cmd',                 'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'pending_fix',               'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'access_code',               'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'access_code_iv',            'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'is_preview',                'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'pr_number',                 'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'project_type',              'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'health_check_strategy',     'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'health_check_path',         'projects', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-G', 'projects', 'recovering_started_at',     'projects', '<dropped>', '0012-column-dropped', strftime('%s','now'));
--> statement-breakpoint

-- Phase H.2: 6 column-dropped audit rows for services
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at) VALUES
  ('0012-C', 'services', 'type',                  'services', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-C', 'services', 'image',                 'services', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-C', 'services', 'port',                  'services', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-C', 'services', 'env_vars',              'services', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-C', 'services', 'deploy_lock_session',   'services', '<dropped>', '0012-column-dropped', strftime('%s','now')),
  ('0012-C', 'services', 'deploy_lock_at',        'services', '<dropped>', '0012-column-dropped', strftime('%s','now'));
--> statement-breakpoint

-- Phase H.3: 6 fk-repointed audit rows for the per-deployable tables
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at) VALUES
  ('0012-B', 'environments',         'project_id', 'environments',         'service_id', '0012-fk-repointed', strftime('%s','now')),
  ('0012-B', 'deploy_configs',       'project_id', 'deploy_configs',       'service_id', '0012-fk-repointed', strftime('%s','now')),
  ('0012-B', 'deploy_logs',          'project_id', 'deploy_logs',          'service_id', '0012-fk-repointed', strftime('%s','now')),
  ('0012-B', 'domain_mappings',      'project_id', 'domain_mappings',      'service_id', '0012-fk-repointed', strftime('%s','now')),
  ('0012-B', 'runtime_incidents',    'project_id', 'runtime_incidents',    'service_id', '0012-fk-repointed', strftime('%s','now')),
  ('0012-B', 'service_ops_overrides','project_id', 'service_ops_overrides','service_id', '0012-fk-repointed', strftime('%s','now'));
--> statement-breakpoint

-- Phase H.4: 5 unique-rebuilt + 3 index-repointed = 8 rows
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at) VALUES
  ('0012-B', 'environments',         'environments_project_type_unique',       'environments',         'environments_service_type_unique',          '0012-unique-rebuilt',  strftime('%s','now')),
  ('0012-B', 'deploy_configs',       'deploy_configs_project_id_unique',       'deploy_configs',       'deploy_configs_service_id_unique',          '0012-unique-rebuilt',  strftime('%s','now')),
  ('0012-B', 'service_ops_overrides','service_ops_overrides_project_unique',   'service_ops_overrides','service_ops_overrides_service_unique',      '0012-unique-rebuilt',  strftime('%s','now')),
  ('0012-D', 'service_connections',  'service_connections_project_service_idx','service_connections',  'service_connections_consumer_provider_idx', '0012-unique-rebuilt',  strftime('%s','now')),
  ('0012-E', 'project_dependencies', '<no-old-unique>',                        'project_dependencies', '<no-new-unique>',                           '0012-unique-rebuilt',  strftime('%s','now')),
  ('0012-B', 'deploy_logs',          'idx_deploy_logs_project',                'deploy_logs',          'idx_deploy_logs_service',                   '0012-index-repointed', strftime('%s','now')),
  ('0012-B', 'domain_mappings',      'idx_domain_mappings_project',            'domain_mappings',      'idx_domain_mappings_service',               '0012-index-repointed', strftime('%s','now')),
  ('0012-B', 'runtime_incidents',    'idx_runtime_incidents_project',          'runtime_incidents',    'idx_runtime_incidents_service',             '0012-index-repointed', strftime('%s','now'));
