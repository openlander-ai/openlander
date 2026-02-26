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
    visibility: text('visibility', { enum: ['internal', 'quick-share', 'production'] }).default(
      'internal',
    ),
    assigned_port: integer('assigned_port').unique(),
    container_id: text('container_id'),
    image_tag: text('image_tag'),
    previous_image_tag: text('previous_image_tag'),
    public_url: text('public_url'),
    parent_project_id: text('parent_project_id').references((): AnySQLiteColumn => projects.id, {
      onDelete: 'cascade',
    }),
    dockerfile_path: text('dockerfile_path').default('Dockerfile'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
    deploy_lock_session: text('deploy_lock_session'),
    deploy_lock_at: text('deploy_lock_at'),
  },
  (table) => [
    check(
      'projects_status_check',
      sql`${table.status} IN ('running', 'stopped', 'building', 'error')`,
    ),
    check(
      'projects_visibility_check',
      sql`${table.visibility} IN ('internal', 'quick-share', 'production')`,
    ),
    index('idx_projects_parent').on(table.parent_project_id),
  ],
);

export const envVars = sqliteTable(
  'env_vars',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('env_vars_project_key_unique').on(table.project_id, table.key),
    index('idx_env_vars_project').on(table.project_id),
  ],
);

export const deployLogs = sqliteTable(
  'deploy_logs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['success', 'failed', 'cancelled'] }),
    trigger: text('trigger_source', { enum: ['chat', 'webhook', 'api'] }),
    commit_sha: text('commit_sha'),
    build_log: text('build_log'),
    duration_ms: integer('duration_ms'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('deploy_logs_status_check', sql`${table.status} IN ('success', 'failed', 'cancelled')`),
    check('deploy_logs_trigger_check', sql`${table.trigger} IN ('chat', 'webhook', 'api')`),
    index('idx_deploy_logs_project').on(table.project_id),
  ],
);

export const chatHistory = sqliteTable(
  'chat_history',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    tool_calls: text('tool_calls'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('chat_history_role_check', sql`${table.role} IN ('user', 'assistant', 'system')`),
    index('idx_chat_history_session').on(table.session_id),
  ],
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

export const drizzleSchema = {
  projects,
  envVars,
  deployLogs,
  chatHistory,
  domainMappings,
  oauthTokens,
  webhookConfigs,
};
