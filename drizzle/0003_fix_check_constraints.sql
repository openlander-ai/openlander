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
	`created_at` text DEFAULT '' NOT NULL
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
DROP TABLE IF EXISTS `__new_projects`;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_url` text,
	`branch` text DEFAULT 'main',
	`status` text DEFAULT 'stopped',
	`visibility` text DEFAULT 'internal',
	`assigned_port` integer,
	`container_id` text,
	`image_tag` text,
	`previous_image_tag` text,
	`public_url` text,
	`parent_project_id` text,
	`dockerfile_path` text DEFAULT 'Dockerfile',
	`docker_target` text,
	`build_context` text,
	`build_method` text,
	`source` text DEFAULT 'git' NOT NULL,
	`image_url` text,
	`image_cmd` text,
	`container_port` integer,
	`pending_fix` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`archived_at` text,
	`deploy_lock_session` text,
	`deploy_lock_at` text,
	`access_code` text,
	`access_code_iv` text,
	`is_preview` integer DEFAULT 0,
	`pr_number` integer,
	`project_type` text DEFAULT 'web' NOT NULL,
	`health_check_strategy` text,
	`health_check_path` text,
	`server_id` text DEFAULT 'local' NOT NULL,
	FOREIGN KEY (`parent_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projects_status_check" CHECK(status IN ('running', 'stopped', 'building', 'error', 'recovering')),
	CONSTRAINT "projects_visibility_check" CHECK(visibility IN ('internal', 'quick-share', 'shared', 'production')),
	CONSTRAINT "projects_build_method_check" CHECK(build_method IN ('dockerfile', 'compose')),
	CONSTRAINT "projects_is_preview_check" CHECK(is_preview IN (0, 1)),
	CONSTRAINT "projects_project_type_check" CHECK(project_type IN ('web', 'worker')),
	CONSTRAINT "projects_health_check_strategy_check" CHECK(health_check_strategy IN ('http', 'tcp', 'exec', 'none')),
	CONSTRAINT "projects_source_check" CHECK(source IN ('git', 'image'))
);
--> statement-breakpoint
INSERT INTO `__new_projects` (
	`id`, `name`, `repo_url`, `branch`, `status`, `visibility`, `assigned_port`,
	`container_id`, `image_tag`, `previous_image_tag`, `public_url`, `parent_project_id`,
	`dockerfile_path`, `docker_target`, `build_context`, `build_method`, `source`,
	`image_url`, `image_cmd`, `container_port`, `pending_fix`, `created_at`, `updated_at`,
	`archived_at`, `deploy_lock_session`, `deploy_lock_at`, `access_code`, `access_code_iv`,
	`is_preview`, `pr_number`, `project_type`, `health_check_strategy`, `health_check_path`,
	`server_id`
) SELECT
	`id`, `name`, `repo_url`, `branch`, `status`, `visibility`, `assigned_port`,
	`container_id`, `image_tag`, `previous_image_tag`, `public_url`, `parent_project_id`,
	`dockerfile_path`, `docker_target`, `build_context`, `build_method`, `source`,
	`image_url`, `image_cmd`, `container_port`, `pending_fix`, `created_at`, `updated_at`,
	`archived_at`, `deploy_lock_session`, `deploy_lock_at`, `access_code`, `access_code_iv`,
	`is_preview`, `pr_number`, `project_type`, `health_check_strategy`, `health_check_path`,
	`server_id`
FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `projects_assigned_port_unique` ON `projects` (`assigned_port`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_projects_parent` ON `projects` (`parent_project_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
