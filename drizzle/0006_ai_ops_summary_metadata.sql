ALTER TABLE "ai_ops_briefings" ADD COLUMN "llm_summary_status" text;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings" ADD COLUMN "llm_summary_finish_reason" text;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings" ADD COLUMN "llm_summary_truncated" boolean;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings" ADD COLUMN "llm_summary_error" text;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings" ADD COLUMN "llm_summary_usage_json" text;
--> statement-breakpoint
ALTER TABLE "ai_ops_briefings" ADD CONSTRAINT "ai_ops_briefings_llm_summary_status_check" CHECK ("ai_ops_briefings"."llm_summary_status" IS NULL OR "ai_ops_briefings"."llm_summary_status" IN ('llm', 'fallback', 'skipped'));
