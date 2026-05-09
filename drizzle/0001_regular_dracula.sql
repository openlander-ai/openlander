ALTER TABLE "environments" ALTER COLUMN "branch" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "environments" ALTER COLUMN "branch" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "repo_url" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "branch" text;--> statement-breakpoint
UPDATE "services" AS s
SET
  "repo_url" = p."repo_url",
  "branch" = NULLIF(p."branch", '')
FROM "projects" AS p
WHERE
  s."project_id" = p."id"
  AND s."kind" IN ('git', 'compose', 'compose-child')
  AND s."repo_url" IS NULL
  AND p."repo_url" IS NOT NULL;--> statement-breakpoint
UPDATE "environments" AS e
SET "branch" = NULL
FROM "services" AS s
WHERE e."service_id" = s."id" AND s."kind" = 'image';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "services" AS s
    JOIN "projects" AS p ON p."id" = s."project_id"
    WHERE
      s."kind" IN ('git', 'compose', 'compose-child')
      AND p."repo_url" IS NOT NULL
      AND s."repo_url" IS NULL
  ) THEN
    RAISE EXCEPTION 'OpenLander service source backfill failed; aborting project source column drop';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "repo_url";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "branch";
