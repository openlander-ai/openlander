import type { SqliteDatabase } from './drizzle.js';
import { SCHEMA } from './schema.js';

/**
 * Initialize the database by creating tables and running migrations.
 */
export function initializeDatabase(sqlite: SqliteDatabase): void {
  sqlite.exec(SCHEMA);
  runMigrations(sqlite);
}

/**
 * Run all schema migrations.
 */
export function runMigrations(sqlite: SqliteDatabase): void {
  sqlite.exec('DROP TABLE IF EXISTS chat_history');

  const columns = sqlite.prepare("PRAGMA table_info('projects')").all() as Array<{
    name: string;
  }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has('parent_project_id')) {
    sqlite.exec(
      'ALTER TABLE projects ADD COLUMN parent_project_id TEXT REFERENCES projects(id) ON DELETE CASCADE',
    );
  }
  if (!colNames.has('dockerfile_path')) {
    sqlite.exec("ALTER TABLE projects ADD COLUMN dockerfile_path TEXT DEFAULT 'Dockerfile'");
  }
  if (!colNames.has('docker_target')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN docker_target TEXT DEFAULT NULL');
  }
  if (!colNames.has('build_context')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN build_context TEXT DEFAULT NULL');
  }
  if (!colNames.has('build_method')) {
    sqlite.exec(
      "ALTER TABLE projects ADD COLUMN build_method TEXT DEFAULT NULL CHECK(build_method IN ('dockerfile', 'compose'))",
    );
  }
  if (!colNames.has('pending_fix')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN pending_fix TEXT DEFAULT NULL');
  }
  if (!colNames.has('deploy_lock_session')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_session TEXT DEFAULT NULL');
  }
  if (!colNames.has('deploy_lock_at')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN deploy_lock_at DATETIME DEFAULT NULL');
  }
  if (!colNames.has('access_code')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN access_code TEXT');
  }
  if (!colNames.has('access_code_iv')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN access_code_iv TEXT');
  }
  if (!colNames.has('is_preview')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN is_preview INTEGER DEFAULT 0');
  }
  if (!colNames.has('pr_number')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN pr_number INTEGER');
  }
  if (!colNames.has('source')) {
    sqlite.exec("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'git'");
  }
  if (!colNames.has('image_url')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN image_url TEXT DEFAULT NULL');
  }
  if (!colNames.has('image_cmd')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN image_cmd TEXT DEFAULT NULL');
  }
  if (!colNames.has('container_port')) {
    sqlite.exec('ALTER TABLE projects ADD COLUMN container_port INTEGER DEFAULT NULL');
  }
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS environments (
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
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)');

  const envVarColumns = sqlite.prepare("PRAGMA table_info('env_vars')").all() as Array<{
    name: string;
  }>;
  const envVarColumnNames = new Set(envVarColumns.map((c) => c.name));
  const envVarTable = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'env_vars'")
    .get() as { sql: string | null } | undefined;
  const hasLegacyProjectKeyUnique =
    typeof envVarTable?.sql === 'string' && envVarTable.sql.includes('UNIQUE(project_id, key)');

  if (hasLegacyProjectKeyUnique) {
    const environmentIdSelect = envVarColumnNames.has('environment_id')
      ? 'environment_id'
      : 'NULL AS environment_id';

    sqlite.exec(`CREATE TABLE env_vars_migrated (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    sqlite.exec(`INSERT INTO env_vars_migrated (
      id,
      project_id,
      environment_id,
      key,
      value,
      created_at
    ) SELECT
      id,
      project_id,
      ${environmentIdSelect},
      key,
      value,
      created_at
    FROM env_vars`);
    sqlite.exec('DROP TABLE env_vars');
    sqlite.exec('ALTER TABLE env_vars_migrated RENAME TO env_vars');
  } else if (!envVarColumnNames.has('environment_id')) {
    sqlite.exec(
      'ALTER TABLE env_vars ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
    );
  }

  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_project');
  sqlite.exec('DROP INDEX IF EXISTS idx_env_vars_environment');
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_key_global_unique ON env_vars(project_id, key) WHERE environment_id IS NULL',
  );
  sqlite.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS env_vars_project_environment_key_unique ON env_vars(project_id, environment_id, key) WHERE environment_id IS NOT NULL',
  );
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_project ON env_vars(project_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON env_vars(environment_id)');

  sqlite.exec(`INSERT INTO environments (
    id,
    project_id,
    type,
    branch,
    status,
    assigned_port,
    container_id,
    image_tag,
    previous_image_tag,
    public_url
  )
  SELECT
    lower(hex(randomblob(8))),
    p.id,
    'production',
    COALESCE(p.branch, 'main'),
    COALESCE(p.status, 'idle'),
    p.assigned_port,
    p.container_id,
    p.image_tag,
    p.previous_image_tag,
    p.public_url
  FROM projects p
  WHERE NOT EXISTS (
    SELECT 1 FROM environments e
    WHERE e.project_id = p.id AND e.type = 'production'
  )`);

  // deploy_logs migrations
  const dlCols = sqlite.prepare("PRAGMA table_info('deploy_logs')").all() as Array<{
    name: string;
  }>;
  const dlColNames = new Set(dlCols.map((c) => c.name));

  if (!dlColNames.has('trigger_source')) {
    sqlite.exec(
      "ALTER TABLE deploy_logs ADD COLUMN trigger_source TEXT CHECK(trigger_source IN ('chat', 'webhook', 'api'))",
    );
  }
  if (!dlColNames.has('environment_id')) {
    sqlite.exec(
      'ALTER TABLE deploy_logs ADD COLUMN environment_id TEXT REFERENCES environments(id) ON DELETE CASCADE',
    );
  }
  if (!dlColNames.has('trigger_detail')) {
    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN trigger_detail TEXT');
  }
  if (!dlColNames.has('commit_message')) {
    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN commit_message TEXT');
  }
  if (!dlColNames.has('runtime_log')) {
    sqlite.exec('ALTER TABLE deploy_logs ADD COLUMN runtime_log TEXT');
  }
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_deploy_logs_environment ON deploy_logs(environment_id)',
  );

  // global_secrets table (v0.0.10)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS global_secrets (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    encrypted_value TEXT NOT NULL,
    iv TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_global_secrets_key ON global_secrets(key)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS services (
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
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS timeline_events (
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
  )`);
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_events(project_id, created_at)',
  );

  const svcTable = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'services'")
    .get() as { sql: string | null } | undefined;
  const svcCols = sqlite.prepare("PRAGMA table_info('services')").all() as Array<{
    name: string;
  }>;
  const svcColNames = new Set(svcCols.map((c) => c.name));

  const hasLegacyTypeCheck =
    typeof svcTable?.sql === 'string' &&
    svcTable.sql.includes("CHECK(type IN ('postgresql', 'mysql', 'redis', 'mongodb'))");

  if (hasLegacyTypeCheck) {
    const envVarsSelect = svcColNames.has('env_vars') ? 'env_vars' : 'NULL';

    sqlite.exec(`CREATE TABLE services_migrated (
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
    )`);
    sqlite.exec(`INSERT INTO services_migrated (
      id,
      name,
      type,
      image,
      status,
      container_id,
      container_name,
      port,
      env_vars,
      credentials,
      created_at,
      updated_at
    ) SELECT
      id,
      name,
      type,
      image,
      status,
      container_id,
      container_name,
      port,
      ${envVarsSelect},
      credentials,
      created_at,
      updated_at
    FROM services`);
    sqlite.exec('DROP TABLE services');
    sqlite.exec('ALTER TABLE services_migrated RENAME TO services');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_services_type ON services(type)');

    // secret_files table (v0.4.2)
    sqlite.exec(`CREATE TABLE IF NOT EXISTS secret_files (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    filename TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    iv TEXT NOT NULL,
    mount_path TEXT NOT NULL DEFAULT '/run/secrets',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_secret_files_project ON secret_files(project_id)');
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_secret_files_unique ON secret_files(project_id, filename)`,
    );
  } else if (!svcColNames.has('env_vars')) {
    sqlite.exec('ALTER TABLE services ADD COLUMN env_vars TEXT');
  }

  // deploy_plans table (v1.0.0)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS deploy_plans (
    id TEXT PRIMARY KEY,
    project_name TEXT,
    project_id TEXT,
    status TEXT NOT NULL,
    complexity TEXT,
    plan_json TEXT NOT NULL,
    commit_sha TEXT,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    executed_at TEXT,
    completed_at TEXT
  )`);
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_deploy_plans_project_name ON deploy_plans(project_name)',
  );
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_deploy_plans_created_at ON deploy_plans(created_at)');

  sqlite.exec(`CREATE TABLE IF NOT EXISTS deploy_configs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    config_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS idx_deploy_configs_project ON deploy_configs(project_id)',
  );

  // auth table (v1.0.0-rc.2)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY DEFAULT 1,
    password_hash TEXT NOT NULL,
    api_token TEXT NOT NULL,
    api_token_iv TEXT,
    session_token TEXT,
    session_created_at INTEGER,
    session_expires_at INTEGER,
    CHECK(id = 1)
  )`);

  // ai_usage_log table (v1.0.0-ai)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS ai_usage_log (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    session_id TEXT,
    action_type TEXT NOT NULL CHECK(action_type IN ('web_agent', 'auto_recovery', 'build_debugger', 'monitor_alert')),
    model_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    tools_called TEXT NOT NULL DEFAULT '[]',
    result TEXT NOT NULL CHECK(result IN ('success', 'failure', 'partial')),
    duration_ms INTEGER NOT NULL DEFAULT 0,
    user_id TEXT,
    tenant_id TEXT,
    source TEXT CHECK(source IN ('web', 'mcp', 'auto-recovery', 'monitor')),
    created_at TEXT NOT NULL
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_log_project ON ai_usage_log(project_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON ai_usage_log(created_at)');

  // action_runs table (v1.0.0-ai)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS action_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    trigger_source TEXT NOT NULL CHECK(trigger_source IN ('web_agent', 'auto_recovery', 'monitor', 'mcp')),
    trigger_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'succeeded', 'failed')),
    error_message TEXT,
    recovery_strategy TEXT CHECK(recovery_strategy IN ('recipe', 'llm', 'unknown')),
    steps_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    tenant_id TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL
  )`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_action_runs_project ON action_runs(project_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_action_runs_status ON action_runs(status)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_action_runs_created_at ON action_runs(created_at)');
}
