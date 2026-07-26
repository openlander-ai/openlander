CREATE TABLE "engagement_weekly_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"evidence_sha256" text NOT NULL,
	"internal_html_blob_id" text,
	"internal_pdf_blob_id" text,
	"customer_html_blob_id" text,
	"customer_pdf_blob_id" text,
	"internal_sha256" text,
	"customer_sha256" text,
	"created_by" text NOT NULL,
	"published_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "engagement_weekly_reports_revision_check" CHECK ("engagement_weekly_reports"."revision" > 0),
	CONSTRAINT "engagement_weekly_reports_status_check" CHECK ("engagement_weekly_reports"."status" IN ('draft', 'published')),
	CONSTRAINT "engagement_weekly_reports_evidence_sha_check" CHECK (length("engagement_weekly_reports"."evidence_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "project_environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"tier" text NOT NULL,
	"promotion_order" integer NOT NULL,
	"manifest_sha256" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "project_environments_tier_check" CHECK ("project_environments"."tier" IN ('development', 'validation', 'production')),
	CONSTRAINT "project_environments_order_check" CHECK ("project_environments"."promotion_order" >= 0),
	CONSTRAINT "project_environments_manifest_sha256_check" CHECK (length("project_environments"."manifest_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "release_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"service_id" text NOT NULL,
	"image_reference" text NOT NULL,
	"image_digest" text NOT NULL,
	"build_provenance" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "release_artifacts_digest_check" CHECK ("release_artifacts"."image_digest" ~ '^sha256:[0-9A-Fa-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "release_promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text NOT NULL,
	"project_environment_id" text NOT NULL,
	"previous_release_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"health_status" text DEFAULT 'pending' NOT NULL,
	"soak_status" text DEFAULT 'pending' NOT NULL,
	"deploy_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"runtime_environment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"initiated_by" text NOT NULL,
	"started_at" text,
	"completed_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "release_promotions_status_check" CHECK ("release_promotions"."status" IN ('pending', 'deploying', 'succeeded', 'failed', 'rolled_back')),
	CONSTRAINT "release_promotions_health_check" CHECK ("release_promotions"."health_status" IN ('pending', 'healthy', 'unhealthy')),
	CONSTRAINT "release_promotions_soak_check" CHECK ("release_promotions"."soak_status" IN ('pending', 'passed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"version" text NOT NULL,
	"commit_sha" text NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "releases_status_check" CHECK ("releases"."status" IN ('building', 'ready', 'recalled', 'failed')),
	CONSTRAINT "releases_commit_sha_check" CHECK (length("releases"."commit_sha") IN (40, 64))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_environments_key_unique" ON "project_environments" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_environments_order_unique" ON "project_environments" USING btree ("project_id","promotion_order");--> statement-breakpoint
ALTER TABLE "environments" DROP CONSTRAINT "environments_type_check";--> statement-breakpoint
DROP INDEX "environments_service_type_unique";--> statement-breakpoint
ALTER TABLE "environments" ADD COLUMN "project_environment_id" text;--> statement-breakpoint
INSERT INTO "project_environments" (
	"id", "project_id", "key", "display_name", "tier", "promotion_order", "manifest_sha256"
)
SELECT DISTINCT
	'penv_legacy_' || md5("service"."project_id" || ':' || "environment"."type"),
	"service"."project_id",
	"environment"."type",
	CASE "environment"."type"
		WHEN 'development' THEN 'Development'
		ELSE 'Production'
	END,
	"environment"."type",
	CASE "environment"."type"
		WHEN 'development' THEN 0
		ELSE 100
	END,
	repeat('0', 64)
FROM "environments" AS "environment"
INNER JOIN "services" AS "service" ON "service"."id" = "environment"."service_id"
ON CONFLICT ("project_id", "key") DO NOTHING;--> statement-breakpoint
UPDATE "environments" AS "environment"
SET "project_environment_id" = "project_environment"."id"
FROM "services" AS "service", "project_environments" AS "project_environment"
WHERE "service"."id" = "environment"."service_id"
	AND "project_environment"."project_id" = "service"."project_id"
	AND "project_environment"."key" = "environment"."type";--> statement-breakpoint
ALTER TABLE "engagement_weekly_reports" ADD CONSTRAINT "engagement_weekly_reports_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_weekly_reports" ADD CONSTRAINT "engagement_weekly_reports_internal_html_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("internal_html_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_weekly_reports" ADD CONSTRAINT "engagement_weekly_reports_internal_pdf_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("internal_pdf_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_weekly_reports" ADD CONSTRAINT "engagement_weekly_reports_customer_html_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("customer_html_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_weekly_reports" ADD CONSTRAINT "engagement_weekly_reports_customer_pdf_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("customer_pdf_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_environments" ADD CONSTRAINT "project_environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_artifacts" ADD CONSTRAINT "release_artifacts_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_artifacts" ADD CONSTRAINT "release_artifacts_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_promotions" ADD CONSTRAINT "release_promotions_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_promotions" ADD CONSTRAINT "release_promotions_project_environment_id_project_environments_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "public"."project_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_promotions" ADD CONSTRAINT "release_promotions_previous_release_id_releases_id_fk" FOREIGN KEY ("previous_release_id") REFERENCES "public"."releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_agent_run_id_delivery_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."delivery_agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_weekly_reports_revision_unique" ON "engagement_weekly_reports" USING btree ("engagement_id","period_start","period_end","revision");--> statement-breakpoint
CREATE INDEX "idx_engagement_weekly_reports_engagement" ON "engagement_weekly_reports" USING btree ("engagement_id","period_start");--> statement-breakpoint
CREATE INDEX "idx_project_environments_project" ON "project_environments" USING btree ("project_id","promotion_order");--> statement-breakpoint
CREATE UNIQUE INDEX "release_artifacts_service_unique" ON "release_artifacts" USING btree ("release_id","service_id");--> statement-breakpoint
CREATE INDEX "idx_release_artifacts_release" ON "release_artifacts" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_promotions_idempotency_unique" ON "release_promotions" USING btree ("project_environment_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_release_promotions_release" ON "release_promotions" USING btree ("release_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_release_promotions_environment" ON "release_promotions" USING btree ("project_environment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_delivery_version_unique" ON "releases" USING btree ("delivery_id","version");--> statement-breakpoint
CREATE INDEX "idx_releases_delivery" ON "releases" USING btree ("delivery_id","created_at");--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_environment_id_project_environments_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "public"."project_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "environments_service_project_environment_unique" ON "environments" USING btree ("service_id","project_environment_id") WHERE "environments"."project_environment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "environments_service_type_legacy_unique" ON "environments" USING btree ("service_id","type") WHERE "environments"."project_environment_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_environments_project_environment" ON "environments" USING btree ("project_environment_id");--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_type_check" CHECK ("environments"."type" IN ('production', 'development'));
