ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "service_id" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "feature" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN IF NOT EXISTS "briefing_id" text;
--> statement-breakpoint
ALTER TABLE "ai_usage_log"
  ADD CONSTRAINT "ai_usage_log_service_id_services_id_fk"
  FOREIGN KEY ("service_id") REFERENCES "public"."services"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_service" ON "ai_usage_log" USING btree ("service_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_feature" ON "ai_usage_log" USING btree ("feature");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_usage_log_briefing" ON "ai_usage_log" USING btree ("briefing_id");
