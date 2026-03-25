import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    repo_url: text('repo_url'),
    branch: text('branch').default('main'),
    status: text('status', { enum: ['running', 'stopped', 'building', 'error'] }).default(
      'stopped',
    ),
    visibility: text('visibility', {
      enum: ['internal', 'quick-share', 'shared', 'production'],
    }).default('internal'),
    assigned_port: integer('assigned_port').unique(),
    container_id: text('container_id'),
    image_tag: text('image_tag'),
    previous_image_tag: text('previous_image_tag'),
    public_url: text('public_url'),
    parent_project_id: text('parent_project_id').references((): AnySQLiteColumn => projects.id, {
      onDelete: 'cascade',
    }),
    dockerfile_path: text('dockerfile_path').default('Dockerfile'),
    docker_target: text('docker_target'),
    build_context: text('build_context'),
    build_method: text('build_method', { enum: ['dockerfile', 'compose'] }),
    source: text('source').notNull().default('git'),
    image_url: text('image_url'),
    image_cmd: text('image_cmd'),
    container_port: integer('container_port'),
    pending_fix: text('pending_fix'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    deploy_lock_session: text('deploy_lock_session'),
    deploy_lock_at: text('deploy_lock_at'),
    access_code: text('access_code'),
    access_code_iv: text('access_code_iv'),
    is_preview: integer('is_preview').default(0),
    pr_number: integer('pr_number'),
  },
  (table) => [
    check(
      'projects_status_check',
      sql`${table.status} IN ('running', 'stopped', 'building', 'error')`,
    ),
    check(
      'projects_visibility_check',
      sql`${table.visibility} IN ('internal', 'quick-share', 'shared', 'production')`,
    ),
    check('projects_build_method_check', sql`${table.build_method} IN ('dockerfile', 'compose')`),
    check('projects_is_preview_check', sql`${table.is_preview} IN (0, 1)`),
    index('idx_projects_parent').on(table.parent_project_id),
  ],
);

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['production', 'development'] }).notNull(),
    branch: text('branch').notNull().default('main'),
    status: text('status', { enum: ['running', 'stopped', 'building', 'error', 'idle'] }).default(
      'idle',
    ),
    assigned_port: integer('assigned_port').unique(),
    container_id: text('container_id'),
    image_tag: text('image_tag'),
    previous_image_tag: text('previous_image_tag'),
    public_url: text('public_url'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('environments_type_check', sql`${table.type} IN ('production', 'development')`),
    check(
      'environments_status_check',
      sql`${table.status} IN ('running', 'stopped', 'building', 'error', 'idle')`,
    ),
    uniqueIndex('environments_project_type_unique').on(table.project_id, table.type),
    index('idx_environments_project').on(table.project_id),
  ],
);

export const envVars = sqliteTable(
  'env_vars',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'cascade',
    }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('env_vars_project_key_unique').on(table.project_id, table.key),
    index('idx_env_vars_project').on(table.project_id),
    index('idx_env_vars_environment').on(table.environment_id),
  ],
);

export const deployLogs = sqliteTable(
  'deploy_logs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'cascade',
    }),
    status: text('status', { enum: ['success', 'failed', 'cancelled'] }),
    trigger: text('trigger_source', { enum: ['chat', 'webhook', 'api'] }),
    trigger_detail: text('trigger_detail'),
    commit_sha: text('commit_sha'),
    commit_message: text('commit_message'),
    build_log: text('build_log'),
    runtime_log: text('runtime_log'),
    duration_ms: integer('duration_ms'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('deploy_logs_status_check', sql`${table.status} IN ('success', 'failed', 'cancelled')`),
    check('deploy_logs_trigger_check', sql`${table.trigger} IN ('chat', 'webhook', 'api')`),
    index('idx_deploy_logs_project').on(table.project_id),
    index('idx_deploy_logs_environment').on(table.environment_id),
  ],
);

export const timelineEvents = sqliteTable(
  'timeline_events',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    deploy_id: text('deploy_id'),
    type: text('type').notNull(),
    message: text('message').notNull(),
    detail: text('detail'),
    severity: text('severity'),
    percent: integer('percent'),
    tool_name: text('tool_name'),
    action_buttons: text('action_buttons'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_timeline_project').on(table.project_id, table.created_at)],
);

export const domainMappings = sqliteTable(
  'domain_mappings',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    cloudflare_zone_id: text('cloudflare_zone_id'),
    cloudflare_dns_record_id: text('cloudflare_dns_record_id'),
    status: text('status', { enum: ['active', 'pending', 'error'] }).default('active'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('domain_mappings_status_check', sql`${table.status} IN ('active', 'pending', 'error')`),
    index('idx_domain_mappings_project').on(table.project_id),
  ],
);

export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().unique(),
    access_token: text('access_token').notNull(),
    refresh_token: text('refresh_token'),
    expires_at: text('expires_at'),
    token_type: text('token_type').default('Bearer'),
    auth_method: text('auth_method').default('manual'),
    user_email: text('user_email'),
    iv: text('iv'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_oauth_tokens_provider').on(table.provider)],
);

export const webhookConfigs = sqliteTable(
  'webhook_configs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['github', 'gitlab', 'bitbucket'] }).notNull(),
    secret: text('secret').notNull(),
    branch_filter: text('branch_filter').default('main'),
    enabled: integer('enabled').default(1),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check(
      'webhook_configs_source_check',
      sql`${table.source} IN ('github', 'gitlab', 'bitbucket')`,
    ),
    check('webhook_configs_enabled_check', sql`${table.enabled} IN (0, 1)`),
    uniqueIndex('webhook_configs_project_source_unique').on(table.project_id, table.source),
    index('idx_webhook_configs_project_source').on(table.project_id, table.source),
  ],
);

export const globalSecrets = sqliteTable(
  'global_secrets',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    encrypted_value: text('encrypted_value').notNull(),
    iv: text('iv').notNull(),
    description: text('description'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_global_secrets_key').on(table.key)],
);

export const services = sqliteTable(
  'services',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    type: text('type').notNull(),
    image: text('image').notNull(),
    status: text('status', { enum: ['running', 'stopped', 'error'] }).default('stopped'),
    container_id: text('container_id'),
    container_name: text('container_name').notNull().unique(),
    port: integer('port').notNull(),
    env_vars: text('env_vars'),
    credentials: text('credentials'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('services_status_check', sql`${table.status} IN ('running', 'stopped', 'error')`),
    index('idx_services_type').on(table.type),
  ],
);

export const deploy_configs = sqliteTable('deploy_configs', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  config_json: text('config_json').notNull(),
  config_version: integer('config_version').notNull().default(1),
  created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const secretFiles = sqliteTable(
  'secret_files',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    encrypted_content: text('encrypted_content').notNull(),
    iv: text('iv').notNull(),
    mount_path: text('mount_path').notNull().default('/run/secrets'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_secret_files_project').on(table.project_id),
    uniqueIndex('idx_secret_files_unique').on(table.project_id, table.filename),
  ],
);

export const deployPlans = sqliteTable(
  'deploy_plans',
  {
    id: text('id').primaryKey(),
    project_name: text('project_name'),
    project_id: text('project_id'),
    status: text('status').notNull(),
    complexity: text('complexity'),
    plan_json: text('plan_json').notNull(),
    commit_sha: text('commit_sha'),
    error_message: text('error_message'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    executed_at: text('executed_at'),
    completed_at: text('completed_at'),
  },
  (table) => [
    index('idx_deploy_plans_project_name').on(table.project_name),
    index('idx_deploy_plans_created_at').on(table.created_at),
  ],
);

export const auth = sqliteTable(
  'auth',
  {
    id: integer('id').primaryKey().default(1),
    password_hash: text('password_hash').notNull(),
    api_token: text('api_token').notNull(),
    api_token_iv: text('api_token_iv'),
    session_token: text('session_token'),
    session_created_at: integer('session_created_at'),
    session_expires_at: integer('session_expires_at'),
  },
  (table) => [check('auth_id_check', sql`${table.id} = 1`)],
);

export const drizzleSchema = {
  projects,
  environments,
  envVars,
  deployLogs,
  timelineEvents,
  domainMappings,
  oauthTokens,
  webhookConfigs,
  globalSecrets,
  services,
  deploy_configs,
  secretFiles,
  deployPlans,
  auth,
};
