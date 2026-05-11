CREATE TABLE "action_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text DEFAULT '' NOT NULL,
	"trigger_source" text NOT NULL,
	"trigger_session_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"error_message" text,
	"recovery_strategy" text,
	"steps_json" text,
	"started_at" text DEFAULT '' NOT NULL,
	"completed_at" text,
	"tenant_id" text,
	"user_id" text,
	"plan" text,
	"current_step" integer,
	"total_steps" integer,
	"correlation_id" text,
	"updated_at" text,
	"approval_status" text,
	"approval_tool" text,
	"approval_requested_at" text,
	"approval_resolved_at" text,
	"created_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"activity_type" text NOT NULL,
	"severity" text NOT NULL,
	"project_id" text NOT NULL,
	"correlation_id" text,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"session_id" text,
	"action_type" text NOT NULL,
	"model_name" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real,
	"tools_called" text DEFAULT '[]' NOT NULL,
	"result" text NOT NULL,
	"error_message" text,
	"error_type" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"user_id" text,
	"tenant_id" text,
	"source" text,
	"created_at" text DEFAULT '' NOT NULL,
	CONSTRAINT "ai_usage_log_result_check" CHECK ("ai_usage_log"."result" IN ('success', 'failure', 'partial'))
);
--> statement-breakpoint
CREATE TABLE "auth" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"api_token" text NOT NULL,
	"api_token_iv" text,
	"session_token" text,
	"session_created_at" bigint,
	"session_expires_at" bigint,
	"active_scope_project_id" text,
	"destructive_mcp_unlock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "auth_id_check" CHECK ("auth"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "circuit_breaker_state" (
	"project_id" text PRIMARY KEY NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" bigint,
	"opened_at" bigint,
	"state" text DEFAULT 'closed' NOT NULL,
	"reset_at" bigint,
	CONSTRAINT "circuit_breaker_state_check" CHECK ("circuit_breaker_state"."state" IN ('closed', 'open', 'half_open'))
);
--> statement-breakpoint
CREATE TABLE "deploy_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"environment_id" text,
	"status" text,
	"trigger_source" text,
	"trigger_detail" text,
	"commit_sha" text,
	"commit_message" text,
	"build_log" text,
	"runtime_log" text,
	"duration_ms" integer,
	"created_at" text DEFAULT now()::text,
	"server_id" text DEFAULT 'local' NOT NULL,
	CONSTRAINT "deploy_logs_status_check" CHECK ("deploy_logs"."status" IN ('success', 'failed', 'cancelled')),
	CONSTRAINT "deploy_logs_trigger_check" CHECK ("deploy_logs"."trigger_source" IN ('chat', 'webhook', 'api'))
);
--> statement-breakpoint
CREATE TABLE "deploy_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_name" text,
	"project_id" text,
	"status" text NOT NULL,
	"complexity" text,
	"plan_json" text NOT NULL,
	"commit_sha" text,
	"error_message" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	"executed_at" text,
	"completed_at" text,
	"server_id" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploy_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"config_json" text NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	CONSTRAINT "deploy_configs_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
CREATE TABLE "deployment_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text DEFAULT '' NOT NULL,
	"pattern_type" text DEFAULT '' NOT NULL,
	"error_signature" text DEFAULT '' NOT NULL,
	"fix_action" text DEFAULT '{}' NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" text,
	"created_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"domain" text NOT NULL,
	"cloudflare_zone_id" text,
	"cloudflare_dns_record_id" text,
	"status" text DEFAULT 'active',
	"path_prefix" text DEFAULT '/' NOT NULL,
	"strip_prefix" boolean DEFAULT false NOT NULL,
	"upstream_path_prefix" text,
	"target_port" integer,
	"tls_enabled" boolean DEFAULT false NOT NULL,
	"tls_resolver" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	CONSTRAINT "domain_mappings_status_check" CHECK ("domain_mappings"."status" IN ('active', 'pending', 'error'))
);
--> statement-breakpoint
CREATE TABLE "env_vars" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"service_id" text,
	"environment_id" text,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" text DEFAULT now()::text
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"type" text NOT NULL,
	"branch" text,
	"status" text DEFAULT 'idle',
	"assigned_port" integer,
	"container_id" text,
	"image_tag" text,
	"previous_image_tag" text,
	"public_url" text,
	"container_port" integer,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	"server_id" text DEFAULT 'local' NOT NULL,
	CONSTRAINT "environments_assigned_port_unique" UNIQUE("assigned_port"),
	CONSTRAINT "environments_type_check" CHECK ("environments"."type" IN ('production', 'development')),
	CONSTRAINT "environments_status_check" CHECK ("environments"."status" IN ('running', 'stopped', 'building', 'error', 'idle'))
);
--> statement-breakpoint
CREATE TABLE "global_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"description" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	CONSTRAINT "global_secrets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "mcp_session_log" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"transport" text NOT NULL,
	"connected_at" bigint NOT NULL,
	"disconnected_at" bigint NOT NULL,
	"client_info" text
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" text,
	"token_type" text DEFAULT 'Bearer',
	"auth_method" text DEFAULT 'manual',
	"user_email" text,
	"iv" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	CONSTRAINT "oauth_tokens_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "ops_incident_events" (
	"id" text PRIMARY KEY NOT NULL,
	"incident_id" text NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"metadata" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "ops_incident_events_type_check" CHECK ("ops_incident_events"."event_type" IN ('detected', 'diagnosed', 'action_taken', 'recovered', 'escalated', 'alert_sent', 'interrupted', 'cascade_detected'))
);
--> statement-breakpoint
CREATE TABLE "ops_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"root_cause" text,
	"diagnosis" text,
	"actions_taken" text,
	"created_at" bigint NOT NULL,
	"resolved_at" bigint,
	"escalated_at" bigint,
	CONSTRAINT "ops_incidents_severity_check" CHECK ("ops_incidents"."severity" IN ('critical', 'warning', 'info')),
	CONSTRAINT "ops_incidents_status_check" CHECK ("ops_incidents"."status" IN ('open', 'active', 'resolved', 'escalated'))
);
--> statement-breakpoint
CREATE TABLE "pat_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_suffix" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_project_id" text,
	"token_type" text DEFAULT 'pat' NOT NULL,
	"capabilities" jsonb,
	"last_used_at" text,
	"expires_at" text,
	"revoked_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"server_id" text DEFAULT 'local' NOT NULL,
	CONSTRAINT "pat_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "pat_tokens_scope_kind_check" CHECK ("pat_tokens"."scope_kind" IN ('org', 'project')),
	CONSTRAINT "pat_tokens_type_check" CHECK ("pat_tokens"."token_type" IN ('pat', 'service', 'legacy-default')),
	CONSTRAINT "pat_tokens_scope_project_check" CHECK (("pat_tokens"."scope_kind" = 'org' AND "pat_tokens"."scope_project_id" IS NULL) OR ("pat_tokens"."scope_kind" = 'project' AND "pat_tokens"."scope_project_id" IS NOT NULL)),
	CONSTRAINT "pat_tokens_expiry_check" CHECK ("pat_tokens"."token_type" = 'legacy-default' OR "pat_tokens"."expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "project_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"source_service_id" text NOT NULL,
	"target_service_id" text,
	"dependency_type" text DEFAULT 'custom' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_ops_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"overrides_json" text NOT NULL,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	CONSTRAINT "service_ops_overrides_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"description" text,
	"tags" text,
	"archived_at" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	"server_id" text DEFAULT 'local' NOT NULL,
	"deploy_lock_session" text,
	"deploy_lock_at" text,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "runtime_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"environment_id" text,
	"category" text NOT NULL,
	"exit_code" integer,
	"error_snippet" text,
	"container_image" text,
	"container_uptime_ms" bigint,
	"restart_count" integer,
	"diagnosis" text,
	"resolved" integer DEFAULT 0 NOT NULL,
	"resolved_at" text,
	"created_at" text NOT NULL,
	"server_id" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_files" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"filename" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"iv" text NOT NULL,
	"mount_path" text DEFAULT '/run/secrets' NOT NULL,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text
);
--> statement-breakpoint
CREATE TABLE "service_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id_consumer" text NOT NULL,
	"service_id_provider" text NOT NULL,
	"environment_id" text,
	"auto_injected_env_keys" text,
	"created_at" text NOT NULL,
	"server_id" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_metrics" (
	"service_id" text NOT NULL,
	"recorded_at" bigint NOT NULL,
	"cpu" real DEFAULT 0 NOT NULL,
	"mem" real DEFAULT 0 NOT NULL,
	"req" real DEFAULT 0 NOT NULL,
	"err" real DEFAULT 0 NOT NULL,
	"p95_latency_ms" real,
	"request_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_service_id" text,
	"status" text DEFAULT 'stopped',
	"visibility" text,
	"assigned_port" integer,
	"container_id" text,
	"container_name" text,
	"container_port" integer,
	"image_tag" text,
	"previous_image_tag" text,
	"public_url" text,
	"dockerfile_path" text DEFAULT 'Dockerfile',
	"docker_target" text,
	"build_context" text,
	"build_method" text,
	"source" text DEFAULT 'git' NOT NULL,
	"repo_url" text,
	"branch" text,
	"image_url" text,
	"image_cmd" text,
	"pending_fix" text,
	"access_code" text,
	"access_code_iv" text,
	"is_preview" integer DEFAULT 0,
	"pr_number" integer,
	"project_type" text DEFAULT 'web' NOT NULL,
	"health_check_strategy" text,
	"health_check_path" text,
	"recovering_started_at" text,
	"credentials" text,
	"created_at" text DEFAULT now()::text,
	"updated_at" text DEFAULT now()::text,
	"archived_at" text,
	"server_id" text DEFAULT 'local' NOT NULL,
	CONSTRAINT "services_name_unique" UNIQUE("name"),
	CONSTRAINT "services_assigned_port_unique" UNIQUE("assigned_port"),
	CONSTRAINT "services_kind_check" CHECK ("services"."kind" IN ('git', 'image', 'compose', 'compose-child', 'postgres', 'mysql', 'redis', 'mongo', 'minio'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" text DEFAULT now()::text
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"deploy_id" text,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"severity" text,
	"percent" integer,
	"tool_name" text,
	"action_buttons" text,
	"created_at" text DEFAULT now()::text
);
--> statement-breakpoint
CREATE TABLE "webhook_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"secret" text NOT NULL,
	"branch_filter" text DEFAULT 'main',
	"enabled" integer DEFAULT 1,
	"created_at" text DEFAULT now()::text,
	CONSTRAINT "webhook_configs_source_check" CHECK ("webhook_configs"."source" IN ('github', 'gitlab', 'bitbucket')),
	CONSTRAINT "webhook_configs_enabled_check" CHECK ("webhook_configs"."enabled" IN (0, 1))
);
--> statement-breakpoint
ALTER TABLE "auth" ADD CONSTRAINT "auth_active_scope_project_id_projects_id_fk" FOREIGN KEY ("active_scope_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_logs" ADD CONSTRAINT "deploy_logs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_logs" ADD CONSTRAINT "deploy_logs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_configs" ADD CONSTRAINT "deploy_configs_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pat_tokens" ADD CONSTRAINT "pat_tokens_scope_project_id_projects_id_fk" FOREIGN KEY ("scope_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_ops_overrides" ADD CONSTRAINT "service_ops_overrides_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_incidents" ADD CONSTRAINT "runtime_incidents_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_incidents" ADD CONSTRAINT "runtime_incidents_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_files" ADD CONSTRAINT "secret_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_connections" ADD CONSTRAINT "service_connections_service_id_consumer_services_id_fk" FOREIGN KEY ("service_id_consumer") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_connections" ADD CONSTRAINT "service_connections_service_id_provider_services_id_fk" FOREIGN KEY ("service_id_provider") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_connections" ADD CONSTRAINT "service_connections_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_metrics" ADD CONSTRAINT "service_metrics_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_parent_service_id_services_id_fk" FOREIGN KEY ("parent_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_action_runs_project" ON "action_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_action_runs_status" ON "action_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_action_runs_created_at" ON "action_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_created_at" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_correlation_id" ON "activity_log" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_project_created" ON "activity_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_log_type_created" ON "activity_log" USING btree ("activity_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_log_project" ON "ai_usage_log" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_log_created_at" ON "ai_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_deploy_logs_service" ON "deploy_logs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_deploy_logs_environment" ON "deploy_logs" USING btree ("environment_id");--> statement-breakpoint
CREATE INDEX "idx_deploy_plans_project_name" ON "deploy_plans" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX "idx_deploy_plans_created_at" ON "deploy_plans" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_deploy_configs_service" ON "deploy_configs" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_deployment_patterns_project" ON "deployment_patterns" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_deployment_patterns_signature" ON "deployment_patterns" USING btree ("project_id","error_signature");--> statement-breakpoint
CREATE INDEX "idx_domain_mappings_service" ON "domain_mappings" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_mappings_domain_path_unique" ON "domain_mappings" USING btree ("domain","path_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_service_key_unique" ON "env_vars" USING btree ("service_id","key") WHERE "env_vars"."service_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_project_group_key_unique" ON "env_vars" USING btree ("project_id","key") WHERE "env_vars"."service_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_env_vars_project" ON "env_vars" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_env_vars_service" ON "env_vars" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_env_vars_environment" ON "env_vars" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_service_type_unique" ON "environments" USING btree ("service_id","type");--> statement-breakpoint
CREATE INDEX "idx_environments_service" ON "environments" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_global_secrets_key" ON "global_secrets" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_mcp_session_log_disconnected_at" ON "mcp_session_log" USING btree ("disconnected_at");--> statement-breakpoint
CREATE INDEX "idx_oauth_tokens_provider" ON "oauth_tokens" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_ops_incident_events_incident" ON "ops_incident_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_ops_incidents_project" ON "ops_incidents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_ops_incidents_status" ON "ops_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pat_tokens_hash" ON "pat_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_pat_tokens_scope" ON "pat_tokens" USING btree ("scope_kind","scope_project_id");--> statement-breakpoint
CREATE INDEX "idx_pat_tokens_expires" ON "pat_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_project_dependencies_source" ON "project_dependencies" USING btree ("source_service_id");--> statement-breakpoint
CREATE INDEX "idx_project_dependencies_target_service" ON "project_dependencies" USING btree ("target_service_id");--> statement-breakpoint
CREATE INDEX "idx_service_ops_overrides_service" ON "service_ops_overrides" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_incidents_service" ON "runtime_incidents" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_runtime_incidents_resolved" ON "runtime_incidents" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "idx_secret_files_project" ON "secret_files" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_secret_files_unique" ON "secret_files" USING btree ("project_id","filename");--> statement-breakpoint
CREATE UNIQUE INDEX "service_connections_consumer_provider_idx" ON "service_connections" USING btree ("service_id_consumer","service_id_provider");--> statement-breakpoint
CREATE INDEX "idx_service_connections_consumer" ON "service_connections" USING btree ("service_id_consumer");--> statement-breakpoint
CREATE INDEX "idx_service_connections_provider" ON "service_connections" USING btree ("service_id_provider");--> statement-breakpoint
CREATE INDEX "idx_service_metrics_service_recorded" ON "service_metrics" USING btree ("service_id","recorded_at");--> statement-breakpoint
CREATE INDEX "idx_services_project" ON "services" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_services_kind" ON "services" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_services_parent" ON "services" USING btree ("parent_service_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_project" ON "timeline_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_configs_project_source_unique" ON "webhook_configs" USING btree ("project_id","source");--> statement-breakpoint
CREATE INDEX "idx_webhook_configs_project_source" ON "webhook_configs" USING btree ("project_id","source");