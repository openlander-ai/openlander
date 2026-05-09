import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  bigint,
  index,
  integer,
  jsonb,
  real,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Post-0012 `projects` table — group-only shape.
 *
 * 25 deprecated deployable columns dropped in migration 0012 Phase G.
 * Final shape = group identity/metadata columns + 2 deploy-lock columns (kept on projects
 * per ADR §"Deploy-lock relocation" option (c); 1.2 follow-up moves locks
 * to a dedicated table).
 */
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  /** Immutable slug used by container/network/route naming. */
  name: text('name').notNull().unique(),
  /** User-visible display name; editable and not unique. */
  display_name: text('display_name').notNull().default(''),
  description: text('description'),
  /** JSON-encoded string array; project groups are lightweight in 0.1. */
  tags: text('tags'),
  archived_at: text('archived_at'),
  created_at: text('created_at').default(sql`now()::text`),
  updated_at: text('updated_at').default(sql`now()::text`),
  server_id: text('server_id').notNull().default('local'),
  // Deploy lock (group-scoped — see ADR §"Deploy-lock relocation").
  deploy_lock_session: text('deploy_lock_session'),
  deploy_lock_at: text('deploy_lock_at'),
});

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    /** Post-0012: canonical FK is service_id; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['production', 'development'] }).notNull(),
    branch: text('branch'),
    status: text('status', { enum: ['running', 'stopped', 'building', 'error', 'idle'] }).default(
      'idle',
    ),
    assigned_port: integer('assigned_port').unique(),
    container_id: text('container_id'),
    image_tag: text('image_tag'),
    previous_image_tag: text('previous_image_tag'),
    public_url: text('public_url'),
    container_port: integer('container_port'),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check('environments_type_check', sql`${table.type} IN ('production', 'development')`),
    check(
      'environments_status_check',
      sql`${table.status} IN ('running', 'stopped', 'building', 'error', 'idle')`,
    ),
    uniqueIndex('environments_service_type_unique').on(table.service_id, table.type),
    index('idx_environments_service').on(table.service_id),
  ],
);

export const envVars = pgTable(
  'env_vars',
  {
    id: text('id').primaryKey(),
    /**
     * Owning project group id. The canonical runtime owner is service_id;
     * project_id stays as grouping context and for temporary group-level
     * compatibility rows when a project has no deployable service yet.
     */
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Canonical owner for deployable env vars. NULL = group compatibility row. */
    service_id: text('service_id').references(() => services.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'cascade',
    }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    created_at: text('created_at').default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('env_vars_service_key_unique')
      .on(table.service_id, table.key)
      .where(sql`${table.service_id} IS NOT NULL`),
    uniqueIndex('env_vars_project_group_key_unique')
      .on(table.project_id, table.key)
      .where(sql`${table.service_id} IS NULL`),
    index('idx_env_vars_project').on(table.project_id),
    index('idx_env_vars_service').on(table.service_id),
    index('idx_env_vars_environment').on(table.environment_id),
  ],
);

export const deployLogs = pgTable(
  'deploy_logs',
  {
    id: text('id').primaryKey(),
    /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
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
    created_at: text('created_at').default(sql`now()::text`),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check('deploy_logs_status_check', sql`${table.status} IN ('success', 'failed', 'cancelled')`),
    check('deploy_logs_trigger_check', sql`${table.trigger} IN ('chat', 'webhook', 'api')`),
    index('idx_deploy_logs_service').on(table.service_id),
    index('idx_deploy_logs_environment').on(table.environment_id),
  ],
);

export const timelineEvents = pgTable(
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
    created_at: text('created_at').default(sql`now()::text`),
  },
  (table) => [index('idx_timeline_project').on(table.project_id, table.created_at)],
);

export const domainMappings = pgTable(
  'domain_mappings',
  {
    id: text('id').primaryKey(),
    /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    cloudflare_zone_id: text('cloudflare_zone_id'),
    cloudflare_dns_record_id: text('cloudflare_dns_record_id'),
    status: text('status', { enum: ['active', 'pending', 'error'] }).default('active'),
    created_at: text('created_at').default(sql`now()::text`),
  },
  (table) => [
    check('domain_mappings_status_check', sql`${table.status} IN ('active', 'pending', 'error')`),
    index('idx_domain_mappings_service').on(table.service_id),
  ],
);

export const oauthTokens = pgTable(
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
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [index('idx_oauth_tokens_provider').on(table.provider)],
);

export const webhookConfigs = pgTable(
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
    created_at: text('created_at').default(sql`now()::text`),
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

export const globalSecrets = pgTable(
  'global_secrets',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull().unique(),
    encrypted_value: text('encrypted_value').notNull(),
    iv: text('iv').notNull(),
    description: text('description'),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [index('idx_global_secrets_key').on(table.key)],
);

/**
 * Post-0012 `services` table — unified deployable + managed services.
 *
 * Phase C of migration 0012 dropped: type, image, port, env_vars,
 * deploy_lock_session, deploy_lock_at. credentials STAYS through 1.0
 * per ADR §"services legacy column rename strategy" (deferred to 1.1
 * paired with managed-services secret refactor).
 */
export const services = pgTable(
  'services',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull().unique(),
    kind: text('kind', {
      enum: [
        'git',
        'image',
        'compose',
        'compose-child',
        'postgres',
        'mysql',
        'redis',
        'mongo',
        'minio',
      ],
    }).notNull(),
    parent_service_id: text('parent_service_id').references((): AnyPgColumn => services.id, {
      onDelete: 'cascade',
    }),
    // Deployable-specific (NULL for managed)
    status: text('status', { enum: ['running', 'stopped', 'error'] }).default('stopped'),
    visibility: text('visibility'),
    assigned_port: integer('assigned_port').unique(),
    container_id: text('container_id'),
    container_name: text('container_name'),
    container_port: integer('container_port'),
    image_tag: text('image_tag'),
    previous_image_tag: text('previous_image_tag'),
    public_url: text('public_url'),
    dockerfile_path: text('dockerfile_path').default('Dockerfile'),
    docker_target: text('docker_target'),
    build_context: text('build_context'),
    build_method: text('build_method'),
    // Source metadata is deployable-owned. For managed services, source='image'
    // and repo_url/branch stay NULL; image_url points at the backing image.
    source: text('source').notNull().default('git'),
    repo_url: text('repo_url'),
    // Nullable by design: NULL means repo default branch for git/compose
    // services, and "not applicable" for image/managed services.
    branch: text('branch'),
    image_url: text('image_url'),
    image_cmd: text('image_cmd'),
    pending_fix: text('pending_fix'),
    access_code: text('access_code'),
    access_code_iv: text('access_code_iv'),
    is_preview: integer('is_preview').default(0),
    pr_number: integer('pr_number'),
    project_type: text('project_type').notNull().default('web'),
    health_check_strategy: text('health_check_strategy'),
    health_check_path: text('health_check_path'),
    recovering_started_at: text('recovering_started_at'),
    /**
     * @deprecated 1.1 — drops paired with managed-services secret refactor.
     * Kept through 1.0 because managed services today carry encrypted
     * credentials inline; replacement is `service_connections.auto_injected_env_keys`
     * with secret-files-backed values.
     */
    credentials: text('credentials'),
    // Common
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
    archived_at: text('archived_at'),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check(
      'services_kind_check',
      sql`${table.kind} IN ('git', 'image', 'compose', 'compose-child', 'postgres', 'mysql', 'redis', 'mongo', 'minio')`,
    ),
    index('idx_services_project').on(table.project_id),
    index('idx_services_kind').on(table.kind),
    index('idx_services_parent').on(table.parent_service_id),
  ],
);

/**
 * Service kind enum — see plan §6.3. Used by callers that branch on
 * deployable vs managed, or compose vs compose-child.
 */
export type ServiceKind =
  | 'git'
  | 'image'
  | 'compose'
  | 'compose-child'
  | 'postgres'
  | 'mysql'
  | 'redis'
  | 'mongo'
  | 'minio';

/**
 * Post-0012 service_connections — consumer/provider model.
 *
 * Renamed from service_id_app/service_id_db → service_id_consumer/
 * service_id_provider in migration 0012 Phase D. Legacy project_id +
 * service_id columns dropped in the same phase.
 */
export const serviceConnections = pgTable(
  'service_connections',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    service_id_consumer: text('service_id_consumer')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    service_id_provider: text('service_id_provider')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    auto_injected_env_keys: text('auto_injected_env_keys'),
    created_at: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    uniqueIndex('service_connections_consumer_provider_idx').on(
      table.service_id_consumer,
      table.service_id_provider,
    ),
    index('idx_service_connections_consumer').on(table.service_id_consumer),
    index('idx_service_connections_provider').on(table.service_id_provider),
  ],
);

export const runtimeIncidents = pgTable(
  'runtime_incidents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id),
    category: text('category').notNull(),
    exit_code: integer('exit_code'),
    error_snippet: text('error_snippet'),
    container_image: text('container_image'),
    container_uptime_ms: bigint('container_uptime_ms', { mode: 'number' }),
    restart_count: integer('restart_count'),
    diagnosis: text('diagnosis'),
    resolved: integer('resolved').notNull().default(0),
    resolved_at: text('resolved_at'),
    created_at: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    index('idx_runtime_incidents_service').on(table.service_id),
    index('idx_runtime_incidents_resolved').on(table.resolved),
  ],
);

export const deploy_configs = pgTable(
  'deploy_configs',
  {
    id: text('id').primaryKey(),
    /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .unique()
      .references(() => services.id, { onDelete: 'cascade' }),
    config_json: text('config_json').notNull(),
    config_version: integer('config_version').notNull().default(1),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [index('idx_deploy_configs_service').on(table.service_id)],
);

/**
 * Post-0012 service_ops_overrides — service-scoped overrides.
 * Renamed from project_ops_overrides in 0009; FK fully repointed in 0012.
 */
export const serviceOpsOverrides = pgTable(
  'service_ops_overrides',
  {
    id: text('id').primaryKey(),
    /** Post-0012: deployable-scoped FK; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .unique()
      .references(() => services.id, { onDelete: 'cascade' }),
    overrides_json: text('overrides_json').notNull(),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [index('idx_service_ops_overrides_service').on(table.service_id)],
);

/** Back-compat alias for the renamed table; existing repo references this name. */
export const project_ops_overrides = serviceOpsOverrides;

export const secretFiles = pgTable(
  'secret_files',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    encrypted_content: text('encrypted_content').notNull(),
    iv: text('iv').notNull(),
    mount_path: text('mount_path').notNull().default('/run/secrets'),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [
    index('idx_secret_files_project').on(table.project_id),
    uniqueIndex('idx_secret_files_unique').on(table.project_id, table.filename),
  ],
);

export const deployPlans = pgTable(
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
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
    executed_at: text('executed_at'),
    completed_at: text('completed_at'),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    index('idx_deploy_plans_project_name').on(table.project_name),
    index('idx_deploy_plans_created_at').on(table.created_at),
  ],
);

// Single-row admin auth state. `active_scope_project_id` is a global MCP
// scope pin for the single-admin v5.1 model, not per-user/per-token state.
export const auth = pgTable(
  'auth',
  {
    id: integer('id').primaryKey().default(1),
    password_hash: text('password_hash').notNull(),
    api_token: text('api_token').notNull(),
    api_token_iv: text('api_token_iv'),
    session_token: text('session_token'),
    session_created_at: bigint('session_created_at', { mode: 'number' }),
    session_expires_at: bigint('session_expires_at', { mode: 'number' }),
    active_scope_project_id: text('active_scope_project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    destructive_mcp_unlock: boolean('destructive_mcp_unlock').notNull().default(false),
  },
  (table) => [check('auth_id_check', sql`${table.id} = 1`)],
);

export const patTokens = pgTable(
  'pat_tokens',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    token_hash: text('token_hash').notNull().unique(),
    token_suffix: text('token_suffix').notNull(),
    scope_kind: text('scope_kind', { enum: ['org', 'project'] }).notNull(),
    scope_project_id: text('scope_project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    token_type: text('token_type', { enum: ['pat', 'service', 'legacy-default'] })
      .notNull()
      .default('pat'),
    capabilities: jsonb('capabilities').$type<Record<string, unknown> | null>(),
    last_used_at: text('last_used_at'),
    expires_at: text('expires_at'),
    revoked_at: text('revoked_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check('pat_tokens_scope_kind_check', sql`${table.scope_kind} IN ('org', 'project')`),
    check(
      'pat_tokens_type_check',
      sql`${table.token_type} IN ('pat', 'service', 'legacy-default')`,
    ),
    check(
      'pat_tokens_scope_project_check',
      sql`(${table.scope_kind} = 'org' AND ${table.scope_project_id} IS NULL) OR (${table.scope_kind} = 'project' AND ${table.scope_project_id} IS NOT NULL)`,
    ),
    check(
      'pat_tokens_expiry_check',
      sql`${table.token_type} = 'legacy-default' OR ${table.expires_at} IS NOT NULL`,
    ),
    index('idx_pat_tokens_hash').on(table.token_hash),
    index('idx_pat_tokens_scope').on(table.scope_kind, table.scope_project_id),
    index('idx_pat_tokens_expires').on(table.expires_at),
  ],
);

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: text('id').notNull().primaryKey(),
    project_id: text('project_id'),
    session_id: text('session_id'),
    action_type: text('action_type', {
      enum: [
        'web_agent',
        'auto_recovery',
        'build_debugger',
        'monitor_alert',
        'system',
        'auto_detect',
        'history_compaction',
      ],
    }).notNull(),
    model_name: text('model_name').notNull().default(''),
    provider: text('provider').notNull().default(''),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    cost_usd: real('cost_usd'),
    tools_called: text('tools_called').notNull().default('[]'),
    result: text('result', { enum: ['success', 'failure', 'partial'] }).notNull(),
    error_message: text('error_message'),
    error_type: text('error_type'),
    duration_ms: integer('duration_ms').notNull().default(0),
    user_id: text('user_id'),
    tenant_id: text('tenant_id'),
    source: text('source', { enum: ['web', 'mcp', 'auto-recovery', 'monitor', 'auto'] }),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [
    check('ai_usage_log_result_check', sql`${table.result} IN ('success', 'failure', 'partial')`),
    index('idx_ai_usage_log_project').on(table.project_id),
    index('idx_ai_usage_log_created_at').on(table.created_at),
  ],
);

export const actionRuns = pgTable(
  'action_runs',
  {
    id: text('id').notNull().primaryKey(),
    project_id: text('project_id').notNull().default(''),
    trigger_source: text('trigger_source', {
      enum: ['web_agent', 'auto_recovery', 'monitor', 'mcp'],
    }).notNull(),
    trigger_session_id: text('trigger_session_id'),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'pending_approval'] })
      .notNull()
      .default('running'),
    error_message: text('error_message'),
    recovery_strategy: text('recovery_strategy', { enum: ['recipe', 'llm', 'memory', 'unknown'] }),
    steps_json: text('steps_json'),
    started_at: text('started_at').notNull().default(''),
    completed_at: text('completed_at'),
    tenant_id: text('tenant_id'),
    user_id: text('user_id'),
    plan: text('plan'),
    current_step: integer('current_step'),
    total_steps: integer('total_steps'),
    correlation_id: text('correlation_id'),
    updated_at: text('updated_at'),
    approval_status: text('approval_status', {
      enum: ['pending', 'approved', 'rejected'],
    }),
    approval_tool: text('approval_tool'),
    approval_requested_at: text('approval_requested_at'),
    approval_resolved_at: text('approval_resolved_at'),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [
    index('idx_action_runs_project').on(table.project_id),
    index('idx_action_runs_status').on(table.status),
    index('idx_action_runs_created_at').on(table.created_at),
  ],
);

export const deploymentPatterns = pgTable(
  'deployment_patterns',
  {
    id: text('id').notNull().primaryKey(),
    project_id: text('project_id').notNull().default(''),
    pattern_type: text('pattern_type').notNull().default(''),
    error_signature: text('error_signature').notNull().default(''),
    fix_action: text('fix_action').notNull().default('{}'),
    success_count: integer('success_count').notNull().default(0),
    failure_count: integer('failure_count').notNull().default(0),
    last_seen_at: text('last_seen_at'),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [
    index('idx_deployment_patterns_project').on(table.project_id),
    index('idx_deployment_patterns_signature').on(table.project_id, table.error_signature),
  ],
);

export const opsIncidents = pgTable(
  'ops_incidents',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').notNull(),
    severity: text('severity', { enum: ['critical', 'warning', 'info'] }).notNull(),
    status: text('status', { enum: ['open', 'active', 'resolved', 'escalated'] })
      .notNull()
      .default('open'),
    root_cause: text('root_cause'),
    diagnosis: text('diagnosis'),
    actions_taken: text('actions_taken'),
    created_at: bigint('created_at', { mode: 'number' }).notNull(),
    resolved_at: bigint('resolved_at', { mode: 'number' }),
    escalated_at: bigint('escalated_at', { mode: 'number' }),
  },
  (table) => [
    check(
      'ops_incidents_severity_check',
      sql`${table.severity} IN ('critical', 'warning', 'info')`,
    ),
    check(
      'ops_incidents_status_check',
      sql`${table.status} IN ('open', 'active', 'resolved', 'escalated')`,
    ),
    index('idx_ops_incidents_project').on(table.project_id),
    index('idx_ops_incidents_status').on(table.status),
  ],
);

export const opsIncidentEvents = pgTable(
  'ops_incident_events',
  {
    id: text('id').primaryKey(),
    incident_id: text('incident_id').notNull(),
    event_type: text('event_type', {
      enum: [
        'detected',
        'diagnosed',
        'action_taken',
        'recovered',
        'escalated',
        'alert_sent',
        'interrupted',
        'cascade_detected',
      ],
    }).notNull(),
    description: text('description').notNull(),
    metadata: text('metadata'),
    created_at: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    check(
      'ops_incident_events_type_check',
      sql`${table.event_type} IN ('detected', 'diagnosed', 'action_taken', 'recovered', 'escalated', 'alert_sent', 'interrupted', 'cascade_detected')`,
    ),
    index('idx_ops_incident_events_incident').on(table.incident_id),
  ],
);

export const circuitBreakerState = pgTable(
  'circuit_breaker_state',
  {
    project_id: text('project_id').primaryKey(),
    failure_count: integer('failure_count').notNull().default(0),
    last_failure_at: bigint('last_failure_at', { mode: 'number' }),
    opened_at: bigint('opened_at', { mode: 'number' }),
    state: text('state', { enum: ['closed', 'open', 'half_open'] })
      .notNull()
      .default('closed'),
    reset_at: bigint('reset_at', { mode: 'number' }),
  },
  (table) => [
    check('circuit_breaker_state_check', sql`${table.state} IN ('closed', 'open', 'half_open')`),
  ],
);

/**
 * Post-0012 project_dependencies — service-scoped only.
 *
 * Phase E dropped legacy source_project_id, target_project_id, and the
 * additive target_managed_service_id was promoted to target_service_id.
 */
export const projectDependencies = pgTable(
  'project_dependencies',
  {
    id: text('id').notNull().primaryKey(),
    source_service_id: text('source_service_id').notNull(),
    target_service_id: text('target_service_id'),
    dependency_type: text('dependency_type', {
      enum: ['database', 'api', 'cache', 'queue', 'storage', 'custom'],
    })
      .notNull()
      .default('custom'),
    source: text('source', { enum: ['auto', 'manual'] })
      .notNull()
      .default('manual'),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [
    index('idx_project_dependencies_source').on(table.source_service_id),
    index('idx_project_dependencies_target_service').on(table.target_service_id),
  ],
);

/**
 * Migration 0009 audit table — append-only log of every source-row -> target-row
 * remap performed by the project/service split. Plan §6.3 / §6.5.
 *
 * Post-0012 the table accumulates 45 additional rows recording column drops,
 * FK repoints, and UNIQUE rebuilds done by 0012 Phases C/D/E/G/H.
 */
export const migration0009Audit = pgTable('migration_0009_audit', {
  phase: text('phase').notNull(),
  source_table: text('source_table').notNull(),
  source_id: text('source_id').notNull(),
  target_table: text('target_table').notNull(),
  target_id: text('target_id').notNull(),
  kind: text('kind'),
  created_at: bigint('created_at', { mode: 'number' }).notNull(),
});

export type Migration0009AuditRow = typeof migration0009Audit.$inferSelect;
export type NewMigration0009Audit = typeof migration0009Audit.$inferInsert;

export type ServiceTableRow = typeof services.$inferSelect;
export type NewServiceTableRow = typeof services.$inferInsert;
export type ProjectTableRow = typeof projects.$inferSelect;
export type NewProjectTableRow = typeof projects.$inferInsert;

export type ProjectDependencyRow = typeof projectDependencies.$inferSelect;
export type NewProjectDependency = typeof projectDependencies.$inferInsert;
export type PatTokenRow = typeof patTokens.$inferSelect;
export type NewPatToken = typeof patTokens.$inferInsert;
export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLog.$inferInsert;
export type ActionRunRow = typeof actionRuns.$inferSelect;
export type NewActionRun = typeof actionRuns.$inferInsert;
export type DeploymentPatternRow = typeof deploymentPatterns.$inferSelect;
export type NewDeploymentPattern = typeof deploymentPatterns.$inferInsert;
export type OpsIncidentRow = typeof opsIncidents.$inferSelect;
export type NewOpsIncident = typeof opsIncidents.$inferInsert;
export type OpsIncidentEventRow = typeof opsIncidentEvents.$inferSelect;
export type NewOpsIncidentEvent = typeof opsIncidentEvents.$inferInsert;
export type CircuitBreakerRow = typeof circuitBreakerState.$inferSelect;
export type NewCircuitBreaker = typeof circuitBreakerState.$inferInsert;

/**
 * Phase E_NEW Task 5 — time-series metrics for v4 service detail
 * sparkline. Recorded by the existing stats collection path (one row
 * per service per sample interval) and aggregated on read by
 * `GET /api/services/:id/metrics`. Independent from `service_stats`
 * (which is a single row per service representing the most-recent
 * snapshot) because the v4 sparkline needs historical retention.
 */
export const serviceMetrics = pgTable(
  'service_metrics',
  {
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    /** Wall-clock millisecond timestamp of the sample (epoch ms). */
    recorded_at: bigint('recorded_at', { mode: 'number' }).notNull(),
    /** CPU percent, 0–100*N where N is core count. */
    cpu: real('cpu').notNull().default(0),
    /** Memory usage in MB. */
    mem: real('mem').notNull().default(0),
    /** Requests-per-second since the last sample. */
    req: real('req').notNull().default(0),
    /** Error rate as percent (e.g. 0.4 = 0.4%). */
    err: real('err').notNull().default(0),
    /** p95 latency in ms — optional, for the aggregate read field. */
    p95_latency_ms: real('p95_latency_ms'),
    /** Per-sample request count, for the aggregate totalRequests read field. */
    request_count: integer('request_count').notNull().default(0),
  },
  (table) => [
    index('idx_service_metrics_service_recorded').on(table.service_id, table.recorded_at),
  ],
);

export type ServiceMetricRow = typeof serviceMetrics.$inferSelect;
export type NewServiceMetric = typeof serviceMetrics.$inferInsert;

/**
 * Phase E_NEW Task 7 — generic key/value settings table for the
 * notifications webhook (single-row keyed on `'notification_webhook'`)
 * and any future single-tenant configuration that doesn't merit a
 * dedicated table. Value is opaque JSON text — callers parse against
 * their own schema.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (_table) => [],
);

export type SettingsRow = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

export const activityLog = pgTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    event_type: text('event_type').notNull(),
    activity_type: text('activity_type').notNull(),
    severity: text('severity').notNull(),
    project_id: text('project_id').notNull(),
    correlation_id: text('correlation_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    status: text('status').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_activity_log_created_at').on(table.created_at),
    index('idx_activity_log_correlation_id').on(table.correlation_id),
    index('idx_activity_log_project_created').on(table.project_id, table.created_at),
    index('idx_activity_log_type_created').on(table.activity_type, table.created_at),
  ],
);

export type ActivityLogRow = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;

/**
 * Per-session audit log for the MCP transport. One row per closed session;
 * powers `mcp_disconnected` synthesis on the v4 /api/activity feed (live
 * sessions are read directly from the in-memory snapshot).
 */
export const mcpSessionLog = pgTable(
  'mcp_session_log',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id').notNull(),
    transport: text('transport', { enum: ['http', 'sse'] }).notNull(),
    connected_at: bigint('connected_at', { mode: 'number' }).notNull(),
    disconnected_at: bigint('disconnected_at', { mode: 'number' }).notNull(),
    client_info: text('client_info'),
  },
  (table) => [index('idx_mcp_session_log_disconnected_at').on(table.disconnected_at)],
);

export type McpSessionLogRow = typeof mcpSessionLog.$inferSelect;
export type NewMcpSessionLog = typeof mcpSessionLog.$inferInsert;

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
  serviceConnections,
  runtimeIncidents,
  deploy_configs,
  serviceOpsOverrides,
  secretFiles,
  deployPlans,
  auth,
  patTokens,
  aiUsageLog,
  actionRuns,
  deploymentPatterns,
  opsIncidents,
  opsIncidentEvents,
  circuitBreakerState,
  projectDependencies,
  serviceMetrics,
  settings,
  activityLog,
  mcpSessionLog,
  migration0009Audit,
};
