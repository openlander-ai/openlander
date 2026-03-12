/**
 * Raw SQL schema for initial table creation (CREATE TABLE IF NOT EXISTS).
 * This matches the Drizzle schema in schema.drizzle.ts and is used only
 * for first-run initialization. Drizzle handles all query operations.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  branch TEXT DEFAULT 'main',
  status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'building', 'error')),
  visibility TEXT DEFAULT 'internal' CHECK(visibility IN ('internal', 'quick-share', 'shared', 'production')),
  assigned_port INTEGER UNIQUE,
  container_id TEXT,
  image_tag TEXT,
  previous_image_tag TEXT,
  public_url TEXT,
  parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  dockerfile_path TEXT DEFAULT 'Dockerfile',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deploy_lock_session TEXT,
  deploy_lock_at TEXT,
  access_code TEXT,
  access_code_iv TEXT,
  is_preview INTEGER DEFAULT 0 CHECK(is_preview IN (0, 1)),
  pr_number INTEGER
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('production', 'staging', 'development')),
  branch TEXT NOT NULL DEFAULT 'main',
  status TEXT DEFAULT 'idle' CHECK(status IN ('running', 'stopped', 'building', 'error', 'idle')),
  assigned_port INTEGER UNIQUE,
  container_id TEXT,
  image_tag TEXT,
  previous_image_tag TEXT,
  public_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, type)
);

CREATE TABLE IF NOT EXISTS env_vars (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, key)
);

CREATE TABLE IF NOT EXISTS deploy_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
  status TEXT CHECK(status IN ('success', 'failed', 'cancelled')),
  trigger_source TEXT CHECK(trigger_source IN ('chat', 'webhook', 'api')),
  commit_sha TEXT,
  build_log TEXT,
  duration_ms INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deploy_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  severity TEXT,
  percent INTEGER,
  tool_name TEXT,
  action_buttons TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE,
  cloudflare_zone_id TEXT,
  cloudflare_dns_record_id TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'pending', 'error')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  token_type TEXT DEFAULT 'Bearer',
  auth_method TEXT DEFAULT 'manual',
  user_email TEXT,
  iv TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('github', 'gitlab', 'bitbucket')),
  secret TEXT NOT NULL,
  branch_filter TEXT DEFAULT 'main',
  enabled INTEGER DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, source)
);

CREATE TABLE IF NOT EXISTS global_secrets (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  image TEXT NOT NULL,
  status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'error')),
  container_id TEXT,
  container_name TEXT NOT NULL UNIQUE,
  port INTEGER NOT NULL,
  env_vars TEXT,
  credentials TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_project ON deploy_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id);
CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_domain_mappings_project ON domain_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_project_source ON webhook_configs(project_id, source);
CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(type);
`;
