ALTER TABLE "project_environments" ADD COLUMN "health_timeout_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_environments" ADD COLUMN "smoke_path" text;--> statement-breakpoint
ALTER TABLE "project_environments" ADD COLUMN "soak_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_health_timeout_check" CHECK ("project_environments"."health_timeout_seconds" BETWEEN 1 AND 600);--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_smoke_path_check" CHECK ("project_environments"."smoke_path" IS NULL OR left("project_environments"."smoke_path", 1) = '/');--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_soak_seconds_check" CHECK ("project_environments"."soak_seconds" BETWEEN 0 AND 3600);