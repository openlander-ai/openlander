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
  created_at: string;
  updated_at: string;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
  access_code: string | null;
  access_code_iv: string | null;
}

export interface DeployLogRow {
  id: string;
  project_id: string;
  status: 'success' | 'failed' | 'cancelled';
  trigger: 'chat' | 'webhook' | 'api';
  commit_sha: string | null;
  build_log: string | null;
  duration_ms: number | null;
  created_at: string;
}
export interface ChatHistoryRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: string | null;
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
