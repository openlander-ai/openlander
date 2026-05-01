-- 0009_split_projects_services.down.sql
--
-- BEST-EFFORT, LOSSY rollback. The recommended rollback path is restore
-- from ~/.openlander/openlander.db.pre-1.0-fullsplit.bak (the backup that
-- the server writes before applying 0009).
--
-- This .down.sql exists for symmetry and emergency hotfix paths only.
-- Lossy facets:
--   * LOSSY: rows inserted into the new `services` table after 0009 ran
--     (kind=git/image/compose/compose-child or managed kinds) cannot
--     reverse-map without explicit audit-log replay; the .down here drops
--     them along with the new shape.
--   * LOSSY: data written into the new service_id_app/service_id_db
--     columns of service_connections after migration is lost on down (the
--     legacy project_id/service_id pair retained their values, but any
--     drift between the two pairs is collapsed onto the legacy pair).
--   * LOSSY: data written into the source_service_id/target_managed_service_id
--     columns of project_dependencies after migration is similarly lost on
--     down. Legacy columns retained their values.
--   * LOSSY: SQLite ALTER TABLE DROP COLUMN requires SQLite >= 3.35; older
--     installs cannot apply this down file directly and must restore from
--     backup.
--
-- Header precedent: drizzle/0007_service_metrics_and_settings.down.sql.

-- LOSSY: drop additive service_id columns added in Phase F.
ALTER TABLE environments DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE env_vars DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE deploy_logs DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE domain_mappings DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE runtime_incidents DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE deploy_configs DROP COLUMN service_id;
--> statement-breakpoint

-- LOSSY: rename service_ops_overrides back to project_ops_overrides + drop service_id.
ALTER TABLE service_ops_overrides DROP COLUMN service_id;
--> statement-breakpoint
ALTER TABLE service_ops_overrides RENAME TO project_ops_overrides;
--> statement-breakpoint

-- LOSSY: drop additive service_id_app/service_id_db columns; legacy
-- project_id/service_id retain their values from before migration.
ALTER TABLE service_connections DROP COLUMN service_id_app;
--> statement-breakpoint
ALTER TABLE service_connections DROP COLUMN service_id_db;
--> statement-breakpoint

-- LOSSY: drop additive service-scoped columns from project_dependencies.
ALTER TABLE project_dependencies DROP COLUMN source_service_id;
--> statement-breakpoint
ALTER TABLE project_dependencies DROP COLUMN target_managed_service_id;
--> statement-breakpoint

-- LOSSY: drop the new services table along with its indexes.
DROP TABLE services;
--> statement-breakpoint

-- LOSSY: drop the new projects table. Recreate the legacy shape and
-- replay rows from `projects_legacy` data captured in audit (note: the
-- audit table only carries id mappings, not full row contents — the
-- recommended path is backup restore).
DROP TABLE projects;
--> statement-breakpoint

-- Recreate legacy projects table (mirrors pre-0009 shape).
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  branch TEXT DEFAULT 'main',
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  deploy_lock_session TEXT,
  deploy_lock_at TEXT,
  access_code TEXT,
  access_code_iv TEXT,
  is_preview INTEGER DEFAULT 0,
  pr_number INTEGER,
  project_type TEXT NOT NULL DEFAULT 'web',
  health_check_strategy TEXT,
  health_check_path TEXT,
  server_id TEXT NOT NULL DEFAULT 'local',
  recovering_started_at TEXT
);
--> statement-breakpoint

-- Recreate legacy services table (mirrors pre-0009 shape).
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT DEFAULT 'stopped',
  container_id TEXT,
  container_name TEXT NOT NULL UNIQUE,
  port INTEGER NOT NULL,
  env_vars TEXT,
  credentials TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  server_id TEXT NOT NULL DEFAULT 'local'
);
--> statement-breakpoint

-- LOSSY: audit table dropped — its records of remap operations are no
-- longer meaningful once the new schema is gone.
DROP TABLE migration_0009_audit;
