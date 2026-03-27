// --- Row types (match DB schema) ---

export type EnvironmentType = 'production' | 'development';

export interface ProjectRow {
  id: string;
  name: string;
  repo_url: string | null;
  branch: string;
  status: 'running' | 'stopped' | 'building' | 'error';
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
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
  access_code: string | null;
  access_code_iv: string | null;
  is_preview: 0 | 1;
  pr_number: number | null;
  auto_recovery_paused: 0 | 1;
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
  content: string;
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
