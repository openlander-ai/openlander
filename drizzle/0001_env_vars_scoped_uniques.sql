DROP INDEX IF EXISTS `env_vars_project_key_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_env_vars_project_key_global` ON `env_vars` (`project_id`, `key`) WHERE `environment_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_env_vars_project_env_key` ON `env_vars` (`project_id`, `environment_id`, `key`) WHERE `environment_id` IS NOT NULL;
