CREATE TABLE "ai_ops_pending_inputs" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "service_id" text NOT NULL,
  "briefing_id" text,
  "field" text NOT NULL,
  "reason" text NOT NULL,
  "source_required" text DEFAULT 'user' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  "resolved_at" text,
  CONSTRAINT "ai_ops_pending_inputs_source_required_check" CHECK ("ai_ops_pending_inputs"."source_required" IN ('user')),
  CONSTRAINT "ai_ops_pending_inputs_status_check" CHECK ("ai_ops_pending_inputs"."status" IN ('pending', 'resolved', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "ai_ops_pending_inputs"
  ADD CONSTRAINT "ai_ops_pending_inputs_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_pending_inputs"
  ADD CONSTRAINT "ai_ops_pending_inputs_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_pending_inputs"
  ADD CONSTRAINT "ai_ops_pending_inputs_briefing_id_ai_ops_briefings_id_fk"
  FOREIGN KEY ("briefing_id") REFERENCES "public"."ai_ops_briefings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_ops_pending_inputs_active_unique" ON "ai_ops_pending_inputs" USING btree ("service_id", "field") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_pending_inputs_project_status" ON "ai_ops_pending_inputs" USING btree ("project_id", "status");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_pending_inputs_service_status" ON "ai_ops_pending_inputs" USING btree ("service_id", "status");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_pending_inputs_briefing" ON "ai_ops_pending_inputs" USING btree ("briefing_id");
