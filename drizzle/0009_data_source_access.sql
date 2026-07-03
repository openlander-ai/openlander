CREATE TABLE "data_source_access" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "service_id" text NOT NULL,
  "environment_id" text,
  "mode" text DEFAULT 'disabled' NOT NULL,
  "reader_username" text,
  "reader_password_encrypted" text,
  "reader_password_iv" text,
  "enabled_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  "server_id" text DEFAULT 'local' NOT NULL,
  CONSTRAINT "data_source_access_mode_check" CHECK ("data_source_access"."mode" IN ('disabled', 'read'))
);
--> statement-breakpoint
ALTER TABLE "data_source_access"
  ADD CONSTRAINT "data_source_access_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_source_access"
  ADD CONSTRAINT "data_source_access_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_source_access"
  ADD CONSTRAINT "data_source_access_environment_id_environments_id_fk"
  FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_source_access_project_service_idx" ON "data_source_access" USING btree ("project_id", "service_id");
--> statement-breakpoint
CREATE INDEX "idx_data_source_access_project" ON "data_source_access" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_data_source_access_service" ON "data_source_access" USING btree ("service_id");
