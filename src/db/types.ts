// --- Row types (match DB schema) ---

export type EnvironmentType = 'production' | 'development';

/**
 * Post-0012 ProjectRow — group-only shape (8 group cols + 2 deploy-lock cols
 * = 10 total). 25 deployable columns dropped in migration 0012 Phase G.
 *
 * The dropped columns remain on the type as `@deprecated` optionals so
 * existing call sites that read them via fallback chains continue to
 * compile through 1.0; runtime SELECT * over the post-0012 schema simply
 * returns rows without those keys (i.e. `undefined` at read time). The
 * `eslint-rules/no-dropped-columns` rule prevents new reads from being
 * introduced, and the soak-grep CI gate alerts on any "no such column"
 * surface in the runtime error log. Both safety nets cover the gap until
 * the 1.1 vocabulary refresh removes the type-side optionals.
 */
export interface ProjectRow {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  server_id: string;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
  /** @deprecated 0012 — column dropped; read services.status via getDeployableForProject */
  status?: 'running' | 'stopped' | 'building' | 'error' | 'recovering' | null;
  /** @deprecated 0012 — column dropped; visibility deferred to 1.1 */
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production' | null;
  /** @deprecated 0012 — column dropped; read services.assigned_port */
  assigned_port?: number | null;
  /** @deprecated 0012 — column dropped; read services.container_id */
  container_id: string | null;
  /** @deprecated 0012 — column dropped; read services.image_tag */
  image_tag?: string | null;
  /** @deprecated 0012 — column dropped; read services.previous_image_tag */
  previous_image_tag?: string | null;
  /** @deprecated 0012 — column dropped; read services.public_url */
  public_url?: string | null;
  /** @deprecated 0012 — column dropped; hierarchy moved to services.parent_service_id */
  parent_project_id?: string | null;
  /** @deprecated 0012 — column dropped; read services.dockerfile_path */
  dockerfile_path?: string | null;
  /** @deprecated 0012 — column dropped; read services.docker_target */
  docker_target?: string | null;
  /** @deprecated 0012 — column dropped; read services.build_context */
  build_context?: string | null;
  /** @deprecated 0012 — column dropped; read services.build_method */
  build_method?: 'dockerfile' | 'compose' | null;
  /** @deprecated 0012 — column dropped; read services.source */
  source?: 'git' | 'image' | null;
  /** @deprecated 0012 — column dropped; read services.image_url */
  image_url?: string | null;
  /** @deprecated 0012 — column dropped; read services.image_cmd */
  image_cmd?: string | null;
  /** @deprecated 0012 — column dropped; read services.container_port */
  container_port?: number | null;
  /** @deprecated 0012 — column dropped; read services.pending_fix */
  pending_fix?: string | null;
  /** @deprecated 0012 — column dropped; access_code deferred to 1.1 */
  access_code?: string | null;
  /** @deprecated 0012 — column dropped */
  access_code_iv?: string | null;
  /** @deprecated 0012 — column dropped; read services.is_preview */
  is_preview?: 0 | 1 | null;
  /** @deprecated 0012 — column dropped; read services.pr_number */
  pr_number?: number | null;
  /** @deprecated 0012 — column dropped; read services.project_type */
  project_type?: 'web' | 'worker' | null;
  /** @deprecated 0012 — column dropped; read services.health_check_strategy */
  health_check_strategy?: 'http' | 'tcp' | 'exec' | 'none' | null;
  /** @deprecated 0012 — column dropped; read services.health_check_path */
  health_check_path?: string | null;
  /** @deprecated 0012 — column dropped; read services.recovering_started_at */
  recovering_started_at?: string | null;
}

export interface EnvironmentRow {
  id: string;
  /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
  service_id: string;
  type: EnvironmentType;
  branch: string | null;
  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  container_port: number | null;
  created_at: string;
  updated_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id`. */
  project_id?: string;
}

export interface DeployLogRow {
  id: string;
  /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
  service_id: string;
  environment_id: string | null;
  status: 'success' | 'failed' | 'cancelled';
  trigger: 'chat' | 'webhook' | 'api';
  trigger_detail: string | null;
  commit_sha: string | null;
  commit_message: string | null;
  build_log: string | null;
  runtime_log: string | null;
  duration_ms: number | null;
  created_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id`. */
  project_id?: string;
}

export interface TimelineEventRow {
  id: string;
  project_id: string;
  deploy_id: string | null;
  type: string;
  message: string;
  detail: string | null;
  severity: string | null;
  percent: number | null;
  tool_name: string | null;
  action_buttons: string | null;
  created_at: string;
}

export interface DomainMappingRow {
  id: string;
  /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
  service_id: string;
  domain: string;
  cloudflare_zone_id: string | null;
  cloudflare_dns_record_id: string | null;
  status: 'active' | 'pending' | 'error';
  created_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id`. */
  project_id?: string;
}

export interface OAuthTokenRow {
  id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  token_type: string;
  auth_method: string | null;
  user_email: string | null;
  iv: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookConfigRow {
  id: string;
  project_id: string;
  source: 'github' | 'gitlab' | 'bitbucket';
  secret: string;
  branch_filter: string;
  enabled: 0 | 1;
  created_at: string;
}

/**
 * Post-0012 ServiceRow — unified deployable + managed services.
 *
 * Phase C of migration 0012 dropped: type, image, port, env_vars,
 * deploy_lock_session, deploy_lock_at. credentials STAYS through 1.0
 * (1.1 follow-up paired with managed-services secret refactor).
 *
 * The dropped columns remain on the type as `@deprecated` optionals so
 * existing call sites that read them via fallback chains continue to
 * compile through 1.0; the eslint `no-dropped-columns` rule and the
 * soak-grep CI gate cover the runtime safety net.
 */
export interface ServiceRow {
  id: string;
  project_id: string;
  name: string;
  kind:
    | 'git'
    | 'image'
    | 'compose'
    | 'compose-child'
    | 'postgres'
    | 'mysql'
    | 'redis'
    | 'mongo'
    | 'minio';
  parent_service_id: string | null;
  status: 'running' | 'stopped' | 'error' | null;
  visibility: 'internal' | 'quick-share' | 'shared' | 'production' | null;
  assigned_port: number | null;
  container_id: string | null;
  container_name: string | null;
  container_port: number | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  dockerfile_path: string | null;
  docker_target: string | null;
  build_context: string | null;
  build_method: 'dockerfile' | 'compose' | null;
  source: string;
  repo_url: string | null;
  branch: string | null;
  image_url: string | null;
  image_cmd: string | null;
  pending_fix: string | null;
  access_code: string | null;
  access_code_iv: string | null;
  is_preview: number | null;
  pr_number: number | null;
  project_type: 'web' | 'worker';
  health_check_strategy: 'http' | 'tcp' | 'exec' | 'none' | null;
  health_check_path: string | null;
  recovering_started_at: string | null;
  /**
   * @deprecated 1.1 — drops paired with managed-services secret refactor.
   */
  credentials: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  server_id: string;
  /** @deprecated 0012 — column dropped; read `kind` instead. */
  type?: string;
  /** @deprecated 0012 — column dropped; read `image_url` instead. */
  image?: string;
  /** @deprecated 0012 — column dropped; read `assigned_port` instead. */
  port?: number;
  /** @deprecated 0012 — column dropped; per-service env vars live in env_vars repo. */
  env_vars?: string | null;
  /** @deprecated 0012 — column dropped; deploy lock lives on projects. */
  deploy_lock_session?: string | null;
  /** @deprecated 0012 — column dropped; deploy lock lives on projects. */
  deploy_lock_at?: string | null;
}

/**
 * Post-0012 ServiceConnectionRow — consumer/provider model.
 * Renamed service_id_app/db → service_id_consumer/provider; legacy
 * project_id + service_id columns dropped.
 */
export interface ServiceConnectionRow {
  id: string;
  service_id_consumer: string;
  service_id_provider: string;
  environment_id: string | null;
  auto_injected_env_keys: string | null;
  created_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id_consumer`. */
  project_id?: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id_provider`. */
  service_id?: string;
  /** @deprecated 0012 — renamed to `service_id_consumer`. */
  service_id_app?: string | null;
  /** @deprecated 0012 — renamed to `service_id_provider`. */
  service_id_db?: string | null;
}

export interface RuntimeIncidentRow {
  id: string;
  /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
  service_id: string;
  environment_id: string | null;
  category: string;
  exit_code: number | null;
  error_snippet: string | null;
  container_image: string | null;
  container_uptime_ms: number | null;
  restart_count: number | null;
  diagnosis: string | null;
  resolved: number;
  resolved_at: string | null;
  created_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id`. */
  project_id?: string;
}

export interface DeployConfigRow {
  id: string;
  /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
  service_id: string;
  config_json: string;
  config_version: number;
  created_at: string;
  updated_at: string;
  /** @deprecated 0012 — column dropped; canonical FK is `service_id`. */
  project_id?: string;
}

export interface PendingFixRow {
  filePath: string;
  content?: string;
  patches?: Array<{
    pattern: string;
    replacement: string;
    flags?: string;
  }>;
}

export interface DeployPlanRow {
  id: string;
  project_name: string | null;
  project_id: string | null;
  status: string;
  complexity: string | null;
  plan_json: string;
  commit_sha: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  executed_at: string | null;
  completed_at: string | null;
}

export interface AuthRow {
  id: number;
  password_hash: string;
  api_token: string;
  api_token_iv: string | null;
  session_token: string | null;
  session_created_at: number | null;
  session_expires_at: number | null;
}

export interface AiUsageLogRow {
  id: string;
  project_id: string | null;
  session_id: string | null;
  action_type:
    | 'web_agent'
    | 'auto_recovery'
    | 'build_debugger'
    | 'monitor_alert'
    | 'system'
    | 'auto_detect'
    | 'history_compaction';
  model_name: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  tools_called: string;
  result: 'success' | 'failure' | 'partial';
  error_message: string | null;
  error_type: string | null;
  duration_ms: number;
  user_id: string | null;
  tenant_id: string | null;
  source: 'web' | 'mcp' | 'auto-recovery' | 'monitor' | 'auto' | null;
  created_at: string;
}

export interface ActionRunRow {
  id: string;
  project_id: string;
  trigger_source: 'web_agent' | 'auto_recovery' | 'monitor' | 'mcp';
  trigger_session_id: string | null;
  status: 'running' | 'succeeded' | 'failed';
  error_message: string | null;
  recovery_strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null;
  steps_json: string | null;
  started_at: string;
  completed_at: string | null;
  tenant_id: string | null;
  user_id: string | null;
  plan: string | null;
  current_step: number | null;
  total_steps: number | null;
  correlation_id: string | null;
  updated_at: string | null;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approval_tool: string | null;
  approval_requested_at: string | null;
  approval_resolved_at: string | null;
  created_at: string;
}

export interface OpsIncidentRow {
  id: string;
  project_id: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'active' | 'resolved' | 'escalated';
  root_cause: string | null;
  diagnosis: string | null;
  actions_taken: string | null;
  created_at: number;
  resolved_at: number | null;
  escalated_at: number | null;
}

export interface OpsIncidentEventRow {
  id: string;
  incident_id: string;
  event_type:
    | 'detected'
    | 'diagnosed'
    | 'action_taken'
    | 'recovered'
    | 'escalated'
    | 'alert_sent'
    | 'interrupted'
    | 'cascade_detected';
  description: string;
  metadata: string | null;
  created_at: number;
}

export interface CircuitBreakerRow {
  project_id: string;
  failure_count: number;
  last_failure_at: number | null;
  opened_at: number | null;
  state: 'closed' | 'open' | 'half_open';
  reset_at: number | null;
}

export interface ActivityLogRow {
  id: string;
  event_type: string;
  activity_type: string;
  severity: string;
  project_id: string;
  correlation_id: string | null;
  title: string;
  description: string;
  status: string;
  metadata: string;
  created_at: string;
}
