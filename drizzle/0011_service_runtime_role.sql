ALTER TABLE "services" ADD COLUMN "runtime_role" text DEFAULT 'application' NOT NULL;
--> statement-breakpoint
UPDATE "services"
SET "runtime_role" = 'resource'
WHERE "kind" IN ('postgres', 'mysql', 'redis', 'mongo', 'minio');
--> statement-breakpoint
ALTER TABLE "services"
  ADD CONSTRAINT "services_runtime_role_check"
  CHECK ("runtime_role" IN ('application', 'job', 'resource'));
--> statement-breakpoint
CREATE INDEX "idx_services_runtime_role" ON "services" USING btree ("runtime_role");
