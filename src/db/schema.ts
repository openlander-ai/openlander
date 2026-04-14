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
  docker_target TEXT DEFAULT NULL,
  build_context TEXT DEFAULT NULL,
   build_method TEXT DEFAULT NULL CHECK(build_method IN ('dockerfile', 'compose')),
   source TEXT NOT NULL DEFAULT 'git' CHECK(source IN ('git', 'image')),
   image_url TEXT DEFAULT NULL,
   image_cmd TEXT DEFAULT NULL,
   container_port INTEGER DEFAULT NULL,
   pending_fix TEXT DEFAULT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deploy_lock_session TEXT,
  deploy_lock_at TEXT,
   access_code TEXT,
    access_code_iv TEXT,
    is_preview INTEGER DEFAULT 0 CHECK(is_preview IN (0, 1)),
     pr_number INTEGER,
     project_type TEXT NOT NULL DEFAULT 'web' CHECK(project_type IN ('web', 'worker')),
     health_check_strategy TEXT DEFAULT NULL CHECK(health_check_strategy IN ('http', 'tcp', 'exec', 'none')),
     health_check_path TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('production', 'development')),
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
  commit_message TEXT,
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

CREATE TABLE IF NOT EXISTS service_connections (
   id TEXT PRIMARY KEY,
   project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
   service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
   environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
   auto_injected_env_keys TEXT,
   created_at TEXT NOT NULL DEFAULT (datetime('now')),
   UNIQUE(project_id, service_id)
);

CREATE TABLE IF NOT EXISTS runtime_incidents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT REFERENCES environments(id),
  category TEXT NOT NULL,
  exit_code INTEGER,
  error_snippet TEXT,
  container_image TEXT,
  container_uptime_ms INTEGER,
  restart_count INTEGER,
  diagnosis TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deploy_configs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deploy_configs_project ON deploy_configs(project_id);

CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id);
CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_project ON deploy_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_domain_mappings_project ON domain_mappings(project_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_project_source ON webhook_configs(project_id, source);
CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(type);
CREATE INDEX IF NOT EXISTS idx_service_connections_project ON service_connections(project_id);
CREATE INDEX IF NOT EXISTS idx_service_connections_service ON service_connections(service_id);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_project ON runtime_incidents(project_id);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_resolved ON runtime_incidents(resolved);

CREATE TABLE IF NOT EXISTS secret_files (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  filename TEXT NOT NULL,
  encrypted_content TEXT NOT NULL,
  iv TEXT NOT NULL,
  mount_path TEXT NOT NULL DEFAULT '/run/secrets',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_secret_files_project ON secret_files(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_secret_files_unique ON secret_files(project_id, filename);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY DEFAULT 1,
  password_hash TEXT NOT NULL,
  api_token TEXT NOT NULL,
  api_token_iv TEXT,
  session_token TEXT,
  session_created_at INTEGER,
  session_expires_at INTEGER,
  CHECK(id = 1)
);

CREATE TABLE IF NOT EXISTS project_dependencies (
  id TEXT PRIMARY KEY NOT NULL,
  source_project_id TEXT NOT NULL,
  target_project_id TEXT,
  target_service_id TEXT,
  dependency_type TEXT NOT NULL DEFAULT 'custom' CHECK(dependency_type IN ('database', 'api', 'cache', 'queue', 'storage', 'custom')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('auto', 'manual')),
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_project_dependencies_source ON project_dependencies(source_project_id);
CREATE INDEX IF NOT EXISTS idx_project_dependencies_target_project ON project_dependencies(target_project_id);
CREATE INDEX IF NOT EXISTS idx_project_dependencies_target_service ON project_dependencies(target_service_id);
`;
