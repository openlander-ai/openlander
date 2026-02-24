/**
 * SQLite schema for OpenLander.
 *
 * Tables:
 * - projects: deployed project state
 * - env_vars: environment variables per project
 * - deploy_logs: deployment history
 * - chat_history: agent conversation logs
 * - domain_mappings: custom domain → project (v0.2)
 */
export const SCHEMA = `
  -- Projects
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    repo_url TEXT,
    branch TEXT DEFAULT 'main',
    status TEXT DEFAULT 'stopped' CHECK(status IN ('running', 'stopped', 'building', 'error')),
    visibility TEXT DEFAULT 'internal' CHECK(visibility IN ('internal', 'quick-share', 'production')),
    assigned_port INTEGER UNIQUE,
    container_id TEXT,
    image_tag TEXT,
    previous_image_tag TEXT,
    public_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Environment variables
  CREATE TABLE IF NOT EXISTS env_vars (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, key)
  );

  -- Deployment logs
  CREATE TABLE IF NOT EXISTS deploy_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT CHECK(status IN ('success', 'failed', 'cancelled')),
    trigger TEXT CHECK(trigger IN ('chat', 'webhook', 'api')),
    commit_sha TEXT,
    build_log TEXT,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Chat history
  CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    tool_calls TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Domain mappings (v0.2, schema created now for forward compatibility)
  CREATE TABLE IF NOT EXISTS domain_mappings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    cloudflare_zone_id TEXT,
    cloudflare_dns_record_id TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'pending', 'error')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- OAuth tokens
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    token_type TEXT DEFAULT 'Bearer',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  -- Webhook configs (v0.2)
  CREATE TABLE IF NOT EXISTS webhook_configs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK(source IN ('github', 'gitlab', 'bitbucket')),
    secret TEXT NOT NULL,
    branch_filter TEXT DEFAULT 'main',
    enabled INTEGER DEFAULT 1 CHECK(enabled IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, source)
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id);
  CREATE INDEX IF NOT EXISTS idx_deploy_logs_project ON deploy_logs(project_id);
  CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id);
  CREATE INDEX IF NOT EXISTS idx_domain_mappings_project ON domain_mappings(project_id);
  CREATE INDEX IF NOT EXISTS idx_oauth_tokens_provider ON oauth_tokens(provider);
  CREATE INDEX IF NOT EXISTS idx_webhook_configs_project_source ON webhook_configs(project_id, source);
`;
