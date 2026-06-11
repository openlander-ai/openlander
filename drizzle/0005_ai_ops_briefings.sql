CREATE TABLE "ai_ops_briefings" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "service_id" text,
  "dedupe_key" text,
  "fingerprint" text NOT NULL,
  "classification" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "deterministic_summary" text NOT NULL,
  "llm_summary" text,
  "suggested_call_json" text,
  "evidence_json" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  "server_id" text DEFAULT 'local' NOT NULL,
  CONSTRAINT "ai_ops_briefings_severity_check" CHECK ("ai_ops_briefings"."severity" IN ('info', 'warning', 'high', 'critical')),
  CONSTRAINT "ai_ops_briefings_status_check" CHECK ("ai_ops_briefings"."status" IN ('open', 'acknowledged', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings"
  ADD CONSTRAINT "ai_ops_briefings_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings"
  ADD CONSTRAINT "ai_ops_briefings_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_briefings_project" ON "ai_ops_briefings" USING btree ("project_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_briefings_service" ON "ai_ops_briefings" USING btree ("service_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_briefings_status" ON "ai_ops_briefings" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_briefings_dedupe" ON "ai_ops_briefings" USING btree ("dedupe_key");
