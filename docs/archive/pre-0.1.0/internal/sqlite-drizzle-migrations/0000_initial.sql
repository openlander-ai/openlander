CREATE TABLE `action_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`trigger_source` text NOT NULL,
	`trigger_session_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`error_message` text,
	`recovery_strategy` text,
	`steps_json` text,
	`started_at` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`tenant_id` text,
	`user_id` text,
	`plan` text,
	`current_step` integer,
	`total_steps` integer,
	`correlation_id` text,
	`updated_at` text,
	`approval_status` text,
	`approval_tool` text,
	`approval_requested_at` text,
	`approval_resolved_at` text,
	`created_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_action_runs_project` ON `action_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_action_runs_status` ON `action_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_action_runs_created_at` ON `action_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`activity_type` text NOT NULL,
	`severity` text NOT NULL,
	`project_id` text NOT NULL,
	`correlation_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_log_created_at` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_correlation_id` ON `activity_log` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_project_created` ON `activity_log` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_log_type_created` ON `activity_log` (`activity_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_log` (
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
CREATE INDEX `idx_ai_usage_log_project` ON `ai_usage_log` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_log_created_at` ON `ai_usage_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`api_token` text NOT NULL,
	`api_token_iv` text,
	`session_token` text,
	`session_created_at` integer,
	`session_expires_at` integer,
	CONSTRAINT "auth_id_check" CHECK("auth"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `circuit_breaker_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer,
	`opened_at` integer,
	`state` text DEFAULT 'closed' NOT NULL,
	`reset_at` integer,
	CONSTRAINT "circuit_breaker_state_check" CHECK("circuit_breaker_state"."state" IN ('closed', 'open', 'half_open'))
);
--> statement-breakpoint
CREATE TABLE `deploy_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`status` text,
	`trigger_source` text,
	`trigger_detail` text,
	`commit_sha` text,
	`commit_message` text,
	`build_log` text,
	`runtime_log` text,
	`duration_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deploy_logs_status_check" CHECK("deploy_logs"."status" IN ('success', 'failed', 'cancelled')),
	CONSTRAINT "deploy_logs_trigger_check" CHECK("deploy_logs"."trigger_source" IN ('chat', 'webhook', 'api'))
);
--> statement-breakpoint
CREATE INDEX `idx_deploy_logs_project` ON `deploy_logs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_deploy_logs_environment` ON `deploy_logs` (`environment_id`);--> statement-breakpoint
CREATE TABLE `deploy_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_name` text,
	`project_id` text,
	`status` text NOT NULL,
	`complexity` text,
	`plan_json` text NOT NULL,
	`commit_sha` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`executed_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_deploy_plans_project_name` ON `deploy_plans` (`project_name`);--> statement-breakpoint
CREATE INDEX `idx_deploy_plans_created_at` ON `deploy_plans` (`created_at`);--> statement-breakpoint
CREATE TABLE `deploy_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`config_json` text NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_configs_project_id_unique` ON `deploy_configs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_deploy_configs_project` ON `deploy_configs` (`project_id`);--> statement-breakpoint
CREATE TABLE `deployment_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`pattern_type` text DEFAULT '' NOT NULL,
	`error_signature` text DEFAULT '' NOT NULL,
	`fix_action` text DEFAULT '{}' NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text,
	`created_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_deployment_patterns_project` ON `deployment_patterns` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_deployment_patterns_signature` ON `deployment_patterns` (`project_id`,`error_signature`);--> statement-breakpoint
CREATE TABLE `domain_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`cloudflare_zone_id` text,
	`cloudflare_dns_record_id` text,
	`status` text DEFAULT 'active',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "domain_mappings_status_check" CHECK("domain_mappings"."status" IN ('active', 'pending', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_mappings_domain_unique` ON `domain_mappings` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_domain_mappings_project` ON `domain_mappings` (`project_id`);--> statement-breakpoint
CREATE TABLE `env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `env_vars_project_key_unique` ON `env_vars` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `idx_env_vars_project` ON `env_vars` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_env_vars_environment` ON `env_vars` (`environment_id`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`status` text DEFAULT 'idle',
	`assigned_port` integer,
	`container_id` text,
	`image_tag` text,
	`previous_image_tag` text,
	`public_url` text,
	`container_port` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "environments_type_check" CHECK("environments"."type" IN ('production', 'development')),
	CONSTRAINT "environments_status_check" CHECK("environments"."status" IN ('running', 'stopped', 'building', 'error', 'idle'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_assigned_port_unique` ON `environments` (`assigned_port`);--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_type_unique` ON `environments` (`project_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_environments_project` ON `environments` (`project_id`);--> statement-breakpoint
CREATE TABLE `global_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`iv` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_secrets_key_unique` ON `global_secrets` (`key`);--> statement-breakpoint
CREATE INDEX `idx_global_secrets_key` ON `global_secrets` (`key`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` text,
	`token_type` text DEFAULT 'Bearer',
	`auth_method` text DEFAULT 'manual',
	`user_email` text,
	`iv` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_provider_unique` ON `oauth_tokens` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_provider` ON `oauth_tokens` (`provider`);--> statement-breakpoint
CREATE TABLE `ops_incident_events` (
	`id` text PRIMARY KEY NOT NULL,
	`incident_id` text NOT NULL,
	`event_type` text NOT NULL,
	`description` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "ops_incident_events_type_check" CHECK("ops_incident_events"."event_type" IN ('detected', 'diagnosed', 'action_taken', 'recovered', 'escalated', 'alert_sent', 'interrupted', 'cascade_detected'))
);
--> statement-breakpoint
CREATE INDEX `idx_ops_incident_events_incident` ON `ops_incident_events` (`incident_id`);--> statement-breakpoint
CREATE TABLE `ops_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`root_cause` text,
	`diagnosis` text,
	`actions_taken` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`escalated_at` integer,
	CONSTRAINT "ops_incidents_severity_check" CHECK("ops_incidents"."severity" IN ('critical', 'warning', 'info')),
	CONSTRAINT "ops_incidents_status_check" CHECK("ops_incidents"."status" IN ('open', 'active', 'resolved', 'escalated'))
);
--> statement-breakpoint
CREATE INDEX `idx_ops_incidents_project` ON `ops_incidents` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_ops_incidents_status` ON `ops_incidents` (`status`);--> statement-breakpoint
CREATE TABLE `project_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`source_project_id` text NOT NULL,
	`target_project_id` text,
	`target_service_id` text,
	`dependency_type` text DEFAULT 'custom' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_dependencies_source` ON `project_dependencies` (`source_project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_dependencies_target_project` ON `project_dependencies` (`target_project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_dependencies_target_service` ON `project_dependencies` (`target_service_id`);--> statement-breakpoint
CREATE TABLE `project_ops_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`overrides_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_ops_overrides_project_id_unique` ON `project_ops_overrides` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_ops_overrides_project` ON `project_ops_overrides` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
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
	FOREIGN KEY (`parent_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projects_status_check" CHECK("projects"."status" IN ('running', 'stopped', 'building', 'error', 'recovering')),
	CONSTRAINT "projects_visibility_check" CHECK("projects"."visibility" IN ('internal', 'quick-share', 'shared', 'production')),
	CONSTRAINT "projects_build_method_check" CHECK("projects"."build_method" IN ('dockerfile', 'compose')),
	CONSTRAINT "projects_is_preview_check" CHECK("projects"."is_preview" IN (0, 1)),
	CONSTRAINT "projects_project_type_check" CHECK("projects"."project_type" IN ('web', 'worker')),
	CONSTRAINT "projects_health_check_strategy_check" CHECK("projects"."health_check_strategy" IN ('http', 'tcp', 'exec', 'none')),
	CONSTRAINT "projects_source_check" CHECK("projects"."source" IN ('git', 'image'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_assigned_port_unique` ON `projects` (`assigned_port`);--> statement-breakpoint
CREATE INDEX `idx_projects_parent` ON `projects` (`parent_project_id`);--> statement-breakpoint
CREATE TABLE `runtime_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`category` text NOT NULL,
	`exit_code` integer,
	`error_snippet` text,
	`container_image` text,
	`container_uptime_ms` integer,
	`restart_count` integer,
	`diagnosis` text,
	`resolved` integer DEFAULT 0 NOT NULL,
	`resolved_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_runtime_incidents_project` ON `runtime_incidents` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_runtime_incidents_resolved` ON `runtime_incidents` (`resolved`);--> statement-breakpoint
CREATE TABLE `secret_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`filename` text NOT NULL,
	`encrypted_content` text NOT NULL,
	`iv` text NOT NULL,
	`mount_path` text DEFAULT '/run/secrets' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_secret_files_project` ON `secret_files` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_secret_files_unique` ON `secret_files` (`project_id`,`filename`);--> statement-breakpoint
CREATE TABLE `service_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`service_id` text NOT NULL,
	`environment_id` text,
	`auto_injected_env_keys` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_connections_project_service_idx` ON `service_connections` (`project_id`,`service_id`);--> statement-breakpoint
CREATE INDEX `idx_service_connections_project` ON `service_connections` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_service_connections_service` ON `service_connections` (`service_id`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`image` text NOT NULL,
	`status` text DEFAULT 'stopped',
	`container_id` text,
	`container_name` text NOT NULL,
	`port` integer NOT NULL,
	`env_vars` text,
	`credentials` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "services_status_check" CHECK("services"."status" IN ('running', 'stopped', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_name_unique` ON `services` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `services_container_name_unique` ON `services` (`container_name`);--> statement-breakpoint
CREATE INDEX `idx_services_type` ON `services` (`type`);--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`deploy_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`detail` text,
	`severity` text,
	`percent` integer,
	`tool_name` text,
	`action_buttons` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_timeline_project` ON `timeline_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhook_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`secret` text NOT NULL,
	`branch_filter` text DEFAULT 'main',
	`enabled` integer DEFAULT 1,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "webhook_configs_source_check" CHECK("webhook_configs"."source" IN ('github', 'gitlab', 'bitbucket')),
	CONSTRAINT "webhook_configs_enabled_check" CHECK("webhook_configs"."enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_configs_project_source_unique` ON `webhook_configs` (`project_id`,`source`);--> statement-breakpoint
CREATE INDEX `idx_webhook_configs_project_source` ON `webhook_configs` (`project_id`,`source`);