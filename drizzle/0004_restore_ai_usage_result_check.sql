PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_ai_usage_log`;--> statement-breakpoint
CREATE TABLE `__new_ai_usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`action_type` text NOT NULL,
	`model_name` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`tools_called` text DEFAULT '[]' NOT NULL,
	`result` text NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`user_id` text,
	`tenant_id` text,
	`source` text,
	`created_at` text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_usage_log_result_check" CHECK("__new_ai_usage_log"."result" IN ('success', 'failure', 'partial'))
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage_log` (
	`id`, `project_id`, `session_id`, `action_type`, `model_name`, `provider`,
	`input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`, `tools_called`,
	`result`, `duration_ms`, `user_id`, `tenant_id`, `source`, `created_at`
) SELECT
	`id`, `project_id`, `session_id`, `action_type`, `model_name`, `provider`,
	`input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`, `tools_called`,
	`result`, `duration_ms`, `user_id`, `tenant_id`, `source`, `created_at`
FROM `ai_usage_log`;--> statement-breakpoint
DROP TABLE `ai_usage_log`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage_log` RENAME TO `ai_usage_log`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_usage_log_project` ON `ai_usage_log` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ai_usage_log_created_at` ON `ai_usage_log` (`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
