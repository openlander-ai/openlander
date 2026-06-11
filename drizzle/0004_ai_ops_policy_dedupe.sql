CREATE TABLE "ai_ops_instance_policy" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "daily_briefing_limit" integer DEFAULT 200 NOT NULL,
  "fingerprint_cooldown_minutes" integer DEFAULT 30 NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "ai_ops_instance_policy_singleton_check" CHECK ("ai_ops_instance_policy"."id" = 1),
  CONSTRAINT "ai_ops_instance_policy_daily_limit_check" CHECK ("ai_ops_instance_policy"."daily_briefing_limit" >= 0),
  CONSTRAINT "ai_ops_instance_policy_cooldown_check" CHECK ("ai_ops_instance_policy"."fingerprint_cooldown_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_ops_project_policies" (
  "project_id" text PRIMARY KEY NOT NULL,
  "mode" text DEFAULT 'off' NOT NULL,
  "daily_briefing_limit" integer DEFAULT 20 NOT NULL,
  "fingerprint_cooldown_minutes" integer DEFAULT 30 NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "ai_ops_project_policies_mode_check" CHECK ("ai_ops_project_policies"."mode" IN ('off', 'briefing')),
  CONSTRAINT "ai_ops_project_policies_daily_limit_check" CHECK ("ai_ops_project_policies"."daily_briefing_limit" >= 0),
  CONSTRAINT "ai_ops_project_policies_cooldown_check" CHECK ("ai_ops_project_policies"."fingerprint_cooldown_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_ops_service_overrides" (
  "service_id" text PRIMARY KEY NOT NULL,
  "mode" text DEFAULT 'inherit' NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "ai_ops_service_overrides_mode_check" CHECK ("ai_ops_service_overrides"."mode" IN ('inherit', 'off', 'briefing'))
);
--> statement-breakpoint
CREATE TABLE "ai_ops_dedupe" (
  "id" text PRIMARY KEY NOT NULL,
  "dedupe_key" text NOT NULL,
  "project_id" text NOT NULL,
  "service_id" text,
  "resource_kind" text,
  "resource_id" text,
  "fingerprint" text NOT NULL,
  "first_seen_at" text DEFAULT now()::text NOT NULL,
  "last_seen_at" text DEFAULT now()::text NOT NULL,
  "cooldown_until" text NOT NULL,
  "occurrences" integer DEFAULT 1 NOT NULL,
  "last_briefing_id" text,
  "server_id" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_ops_project_policies"
  ADD CONSTRAINT "ai_ops_project_policies_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_service_overrides"
  ADD CONSTRAINT "ai_ops_service_overrides_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_dedupe"
  ADD CONSTRAINT "ai_ops_dedupe_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_ops_dedupe"
  ADD CONSTRAINT "ai_ops_dedupe_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_project_policies_mode" ON "ai_ops_project_policies" USING btree ("mode");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_service_overrides_mode" ON "ai_ops_service_overrides" USING btree ("mode");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_ops_dedupe_key_unique" ON "ai_ops_dedupe" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_dedupe_project" ON "ai_ops_dedupe" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_dedupe_service" ON "ai_ops_dedupe" USING btree ("service_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_ops_dedupe_cooldown" ON "ai_ops_dedupe" USING btree ("cooldown_until");
