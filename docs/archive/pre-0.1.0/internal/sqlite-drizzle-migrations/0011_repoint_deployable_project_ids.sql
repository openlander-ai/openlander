-- 0011_repoint_deployable_project_ids.sql
-- =====================================================================
-- Forward-only fix for FK orphans left after 0010.
--
-- 0010 deleted the wrongly-inserted compose-child rows from `projects`,
-- but per-deployable FK tables (environments, deploy_logs,
-- domain_mappings, runtime_incidents, deploy_configs,
-- service_ops_overrides) carry a legacy `project_id` column with FK ->
-- projects(id). After 0010 those rows orphaned and the post-migration
-- `PRAGMA foreign_key_check` refuses startup.
--
-- We can't simply drop the UNIQUE constraints (deploy_configs.project_id
-- UNIQUE, environments(project_id, type) UNIQUE) — too many repos and
-- tests rely on those for upsert semantics.
--
-- We can't re-point legacy project_id from child -> parent group either
-- because multiple compose-children sharing the same parent + same env
-- type would collide on UNIQUE.
--
-- Solution: reconstruct the child `projects` rows that 0010 deleted from
-- the surviving `services` rows (kind='compose-child' rows preserve all
-- the column data 0009 Phase D copied from projects_legacy). Re-inserted
-- rows keep `parent_project_id` populated (so the UI can filter them
-- out via that column or via services.kind), and FK constraints from
-- the per-deployable tables resolve cleanly.
--
-- The user-visible "3 projects shown when it should be 1" issue stays
-- as a UI filtering concern, addressed separately in a 1.0.x patch
-- (`useProjectsContext` filters where `parent_project_id IS NULL`, or
-- the canonical `/api/projects` returns only top-level groups).
--
-- Idempotent: INSERT OR IGNORE skips rows that already exist.
-- =====================================================================

INSERT OR IGNORE INTO projects (
  id, name, repo_url, branch, archived_at, created_at, updated_at, server_id,
  status, visibility, assigned_port, container_id, container_port,
  image_tag, previous_image_tag, public_url, parent_project_id,
  dockerfile_path, docker_target, build_context, build_method, source,
  image_url, image_cmd, pending_fix, deploy_lock_session, deploy_lock_at,
  access_code, access_code_iv, is_preview, pr_number, project_type,
  health_check_strategy, health_check_path, recovering_started_at
)
SELECT
  -- Legacy id (pre-__svc): strip the '__svc' suffix back off.
  CASE
    WHEN s.id LIKE '%__svc' THEN substr(s.id, 1, length(s.id) - length('__svc'))
    ELSE s.id
  END,
  -- Legacy name: same suffix-strip on name.
  CASE
    WHEN s.name LIKE '%__svc' THEN substr(s.name, 1, length(s.name) - length('__svc'))
    ELSE s.name
  END,
  NULL, 'main', NULL, s.created_at, s.updated_at, s.server_id,
  s.status, s.visibility, s.assigned_port, s.container_id, s.container_port,
  s.image_tag, s.previous_image_tag, s.public_url,
  -- The reconstructed row's parent_project_id is the parent group id.
  -- Strip __svc off parent_service_id to recover the legacy id shape
  -- (parent service id = parent group id + '__svc').
  CASE
    WHEN s.parent_service_id LIKE '%__svc' THEN substr(s.parent_service_id, 1, length(s.parent_service_id) - length('__svc'))
    ELSE s.parent_service_id
  END,
  s.dockerfile_path, s.docker_target, s.build_context, s.build_method, s.source,
  s.image_url, s.image_cmd, s.pending_fix, s.deploy_lock_session, s.deploy_lock_at,
  s.access_code, s.access_code_iv, s.is_preview, s.pr_number, s.project_type,
  s.health_check_strategy, s.health_check_path, s.recovering_started_at
FROM services s
WHERE s.kind = 'compose-child';
--> statement-breakpoint

-- Audit log entry — record the reconstruction so forensic queries can
-- distinguish "0010 then 0011" rows from "actually fresh 0009-D" rows.
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT '0011', 'services', s.id, 'projects',
         CASE
           WHEN s.id LIKE '%__svc' THEN substr(s.id, 1, length(s.id) - length('__svc'))
           ELSE s.id
         END,
         'compose-child-reinserted', strftime('%s','now')
  FROM services s
  WHERE s.kind = 'compose-child';
