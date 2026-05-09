DROP INDEX IF EXISTS "env_vars_project_key_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_env_vars_service" ON "env_vars" ("service_id");--> statement-breakpoint
DO $$
DECLARE
  migrated_project record;
BEGIN
  FOR migrated_project IN
    SELECT
      p."name" AS project_name,
      COUNT(DISTINCT ev."key") AS key_count,
      COUNT(DISTINCT s."id") AS service_count,
      COALESCE(string_agg(DISTINCT s."name", ', ' ORDER BY s."name"), '') AS service_names
    FROM "env_vars" ev
    JOIN "projects" p ON p."id" = ev."project_id"
    JOIN "services" s ON s."project_id" = ev."project_id"
    WHERE ev."service_id" IS NULL
      AND s."kind" IN ('git', 'image', 'compose', 'compose-child')
    GROUP BY p."name"
  LOOP
    RAISE NOTICE
      '[migration] env_vars: found % group-level vars on project %, copied to % deployable services (%). Services now own independent copies; future edits no longer propagate across siblings.',
      migrated_project.key_count,
      migrated_project.project_name,
      migrated_project.service_count,
      migrated_project.service_names;
  END LOOP;
END $$;--> statement-breakpoint
INSERT INTO "env_vars" (
  "id",
  "project_id",
  "service_id",
  "environment_id",
  "key",
  "value",
  "created_at"
)
SELECT
  'env_' || substr(md5(ev."id" || ':' || s."id" || ':' || ev."key"), 1, 24),
  ev."project_id",
  s."id",
  NULL,
  ev."key",
  ev."value",
  ev."created_at"
FROM "env_vars" ev
JOIN "services" s ON s."project_id" = ev."project_id"
WHERE ev."service_id" IS NULL
  AND s."kind" IN ('git', 'image', 'compose', 'compose-child')
  AND NOT EXISTS (
    SELECT 1
    FROM "env_vars" existing
    WHERE existing."service_id" = s."id"
      AND existing."key" = ev."key"
  );--> statement-breakpoint
DELETE FROM "env_vars" ev
WHERE ev."service_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "services" s
    WHERE s."project_id" = ev."project_id"
      AND s."kind" IN ('git', 'image', 'compose', 'compose-child')
  );--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "env_vars_service_key_unique"
  ON "env_vars" ("service_id", "key")
  WHERE "service_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "env_vars_project_group_key_unique"
  ON "env_vars" ("project_id", "key")
  WHERE "service_id" IS NULL;
