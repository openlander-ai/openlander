// --- Row types (match DB schema) ---

export type EnvironmentType = 'production' | 'development';

export interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error' | 'recovering';
  visibility: 'internal' | 'quick-share' | 'shared' | 'production';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  parent_project_id: string | null;
  dockerfile_path: string;
  docker_target: string | null;
  build_context: string | null;
  build_method: 'dockerfile' | 'compose' | null;
  source: 'git' | 'image';
  image_url: string | null;
  image_cmd: string | null;
  container_port: number | null;
  pending_fix: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
  access_code: string | null;
  access_code_iv: string | null;
  is_preview: 0 | 1;
  pr_number: number | null;
  project_type: 'web' | 'worker';
  health_check_strategy: 'http' | 'tcp' | 'exec' | 'none' | null;
  health_check_path: string | null;
  server_id: string;
  recovering_started_at: string | null;
}

export interface EnvironmentRow {
  id: string;
  project_id: string;
  type: EnvironmentType;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  container_port: number | null;
  created_at: string;
  updated_at: string;
}

export interface DeployLogRow {
  id: string;
  project_id: string;
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
  project_id: string;
  domain: string;
  cloudflare_zone_id: string | null;
  cloudflare_dns_record_id: string | null;
  status: 'active' | 'pending' | 'error';
  created_at: string;
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

export interface ServiceRow {
  id: string;
  name: string;
  type: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  container_id: string | null;
  container_name: string;
  port: number;
  env_vars: string | null;
  credentials: string | null;
  created_at: string;
  updated_at: string;
  // Post-0009 unified-shape columns. Nullable on managed-only rows
  // (kind ∈ postgres/mysql/redis/mongo/minio) and pre-migration rows.
  // Plan §6.3 + §6.5 — additive transition; legacy columns above stay
  // until the post-1.0 follow-up migration drops them.
  project_id?: string;
  kind?:
    | 'git'
    | 'image'
    | 'compose'
    | 'compose-child'
    | 'postgres'
    | 'mysql'
    | 'redis'
    | 'mongo'
    | 'minio';
  parent_service_id?: string | null;
  assigned_port?: number | null;
  container_port?: number | null;
  image_tag?: string | null;
  previous_image_tag?: string | null;
  public_url?: string | null;
  dockerfile_path?: string | null;
  docker_target?: string | null;
  build_context?: string | null;
  build_method?: 'dockerfile' | 'compose' | null;
  source?: string;
  image_url?: string | null;
  image_cmd?: string | null;
  pending_fix?: string | null;
  deploy_lock_session?: string | null;
  deploy_lock_at?: string | null;
  access_code?: string | null;
  access_code_iv?: string | null;
  is_preview?: number | null;
  pr_number?: number | null;
  project_type?: 'web' | 'worker';
  health_check_strategy?: 'http' | 'tcp' | 'exec' | 'none' | null;
  health_check_path?: string | null;
  recovering_started_at?: string | null;
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production' | null;
  managed_image?: string | null;
  managed_env_vars?: string | null;
  managed_credentials?: string | null;
  archived_at?: string | null;
  server_id?: string;
}

export interface ServiceConnectionRow {
  id: string;
  project_id: string;
  service_id: string;
  environment_id: string | null;
  auto_injected_env_keys: string | null;
  created_at: string;
}

export interface RuntimeIncidentRow {
  id: string;
  project_id: string;
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
}

export interface DeployConfigRow {
  id: string;
  project_id: string;
  config_json: string;
  config_version: number;
  created_at: string;
  updated_at: string;
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
