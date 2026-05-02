-- 0010_cleanup_compose_child_groups.sql
-- =====================================================================
-- Forward-only fix for a Phase D bug in 0009_split_projects_services.
--
-- Phase D's INSERT used `WHERE id != '__orphan_managed'` instead of the
-- planned `WHERE parent_project_id IS NULL`. As a result every legacy
-- compose-child row was inserted into the new `projects` table as its
-- own top-level group. A compose stack of N services therefore appeared
-- as N+1 groups in the UI (parent + N children) instead of 1 group with
-- 1+N services.
--
-- The `services` rows produced by Phase D are already correct:
--   - compose parent  -> services kind='compose', parent_service_id NULL
--   - compose child   -> services kind='compose-child',
--                        project_id  = parent's group id,
--                        parent_service_id = parent's __svc
-- so we only need to clean up the projects-side fan-out.
--
-- Safety: any group-scoped FK row (env_vars at group level,
-- webhook_configs, secret_files) currently pointing at a child group is
-- re-pointed at the parent group BEFORE the DELETE, so nothing dangles.
-- Per-deployable FKs (deploy_logs / domain_mappings / runtime_incidents
-- / etc.) already carry service_id columns from Phase F that resolve
-- correctly against the services table — those rows are untouched.
--
-- Idempotent: re-running 0010 against a clean DB is a no-op because
-- there are no `parent_project_id IS NOT NULL` rows in `projects` after
-- the cleanup.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. env_vars: re-point group-level rows (service_id IS NULL) up to parent.
-- Per §6.1, env_vars stays at projects.id (group). The wrongly-inserted
-- child group rows held their legacy env_vars; move them to the parent
-- so the values keep applying. ON CONFLICT: drop the child copy if the
-- parent already has the same key — the parent value wins (compose
-- "shared" env behaviour).
-- ---------------------------------------------------------------------------
DELETE FROM env_vars
WHERE service_id IS NULL
  AND project_id IN (
    SELECT p.id FROM projects p
    WHERE p.parent_project_id IS NOT NULL
      AND p.id != '__orphan_managed'
  )
  AND EXISTS (
    SELECT 1 FROM env_vars parent_ev, projects p
    WHERE parent_ev.project_id = p.parent_project_id
      AND p.id = env_vars.project_id
      AND parent_ev.key = env_vars.key
      AND parent_ev.service_id IS NULL
  );
--> statement-breakpoint

UPDATE env_vars
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = env_vars.project_id
)
WHERE service_id IS NULL
  AND project_id IN (
    SELECT id FROM projects
    WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. webhook_configs: stays at projects.id (group). Webhooks fire on the
-- repo branch which is a group property; children inherit the parent's
-- repo. Drop conflicting child rows first (parent's webhook wins),
-- then re-point any survivors.
-- ---------------------------------------------------------------------------
DELETE FROM webhook_configs
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
)
AND EXISTS (
  SELECT 1 FROM webhook_configs parent_wc, projects p
  WHERE p.id = webhook_configs.project_id
    AND parent_wc.project_id = p.parent_project_id
    AND parent_wc.source = webhook_configs.source
);
--> statement-breakpoint

UPDATE webhook_configs
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = webhook_configs.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. secret_files: group-shared per src/pipeline/compose.ts:668
-- (`getSecretFilesForDeploy(parentProjectId)`). Drop conflicting child
-- copies, then re-point survivors at parent.
-- ---------------------------------------------------------------------------
DELETE FROM secret_files
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
)
AND EXISTS (
  SELECT 1 FROM secret_files parent_sf, projects p
  WHERE p.id = secret_files.project_id
    AND parent_sf.project_id = p.parent_project_id
    AND parent_sf.filename = secret_files.filename
);
--> statement-breakpoint

UPDATE secret_files
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = secret_files.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Audit-tier tables (no FK enforcement, but rows would dangle):
-- aiUsageLog, actionRuns, deploymentPatterns, opsIncidents,
-- timelineEvents, circuitBreakerState. Re-point project_id from child
-- to parent group so historical queries still resolve.
-- ---------------------------------------------------------------------------
UPDATE ai_usage_log
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = ai_usage_log.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

UPDATE action_runs
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = action_runs.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

UPDATE deployment_patterns
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = deployment_patterns.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

UPDATE ops_incidents
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = ops_incidents.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

UPDATE timeline_events
SET project_id = (
  SELECT parent_project_id FROM projects
  WHERE projects.id = timeline_events.project_id
)
WHERE project_id IN (
  SELECT id FROM projects
  WHERE parent_project_id IS NOT NULL AND id != '__orphan_managed'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Audit log entry — record the cleanup so forensic queries can see
-- what 0010 moved.
-- ---------------------------------------------------------------------------
INSERT INTO migration_0009_audit (phase, source_table, source_id, target_table, target_id, kind, created_at)
  SELECT '0010', 'projects', id, 'projects', parent_project_id, 'compose-child-deleted', strftime('%s','now')
  FROM projects
  WHERE parent_project_id IS NOT NULL
    AND id != '__orphan_managed';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Finally, remove the wrongly-inserted child group rows.
-- ---------------------------------------------------------------------------
DELETE FROM projects
WHERE parent_project_id IS NOT NULL
  AND id != '__orphan_managed';
