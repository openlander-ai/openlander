import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
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
    status: text('status', {
      enum: ['running', 'stopped', 'building', 'error', 'recovering'],
    }).default('stopped'),
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
    archived_at: text('archived_at'),
    deploy_lock_session: text('deploy_lock_session'),
    deploy_lock_at: text('deploy_lock_at'),
    access_code: text('access_code'),
    access_code_iv: text('access_code_iv'),
    is_preview: integer('is_preview').default(0),
    pr_number: integer('pr_number'),
    project_type: text('project_type', { enum: ['web', 'worker'] })
      .notNull()
      .default('web'),
    health_check_strategy: text('health_check_strategy', { enum: ['http', 'tcp', 'exec', 'none'] }),
    health_check_path: text('health_check_path'),
  },
  (table) => [
    check(
      'projects_status_check',
      sql`${table.status} IN ('running', 'stopped', 'building', 'error', 'recovering')`,
    ),
    check(
      'projects_visibility_check',
      sql`${table.visibility} IN ('internal', 'quick-share', 'shared', 'production')`,
    ),
    check('projects_build_method_check', sql`${table.build_method} IN ('dockerfile', 'compose')`),
    check('projects_is_preview_check', sql`${table.is_preview} IN (0, 1)`),
    check('projects_project_type_check', sql`${table.project_type} IN ('web', 'worker')`),
    check(
      'projects_health_check_strategy_check',
      sql`${table.health_check_strategy} IN ('http', 'tcp', 'exec', 'none')`,
    ),
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
    container_port: integer('container_port'),
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

export const serviceConnections = sqliteTable(
  'service_connections',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    auto_injected_env_keys: text('auto_injected_env_keys'),
    created_at: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('service_connections_project_service_idx').on(table.project_id, table.service_id),
    index('idx_service_connections_project').on(table.project_id),
    index('idx_service_connections_service').on(table.service_id),
  ],
);

export const runtimeIncidents = sqliteTable(
  'runtime_incidents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id),
    category: text('category').notNull(),
    exit_code: integer('exit_code'),
    error_snippet: text('error_snippet'),
    container_image: text('container_image'),
    container_uptime_ms: integer('container_uptime_ms'),
    restart_count: integer('restart_count'),
    diagnosis: text('diagnosis'),
    resolved: integer('resolved').notNull().default(0),
    resolved_at: text('resolved_at'),
    created_at: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('idx_runtime_incidents_project').on(table.project_id),
    index('idx_runtime_incidents_resolved').on(table.resolved),
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

export const project_ops_overrides = sqliteTable('project_ops_overrides', {
  id: text('id').primaryKey(),
  project_id: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  overrides_json: text('overrides_json').notNull(),
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

export const aiUsageLog = sqliteTable(
  'ai_usage_log',
  {
    id: text('id').notNull().primaryKey(),
    project_id: text('project_id'),
    session_id: text('session_id'),
    action_type: text('action_type', {
      enum: ['web_agent', 'auto_recovery', 'build_debugger', 'monitor_alert'],
    }).notNull(),
    model_name: text('model_name').notNull().default(''),
    provider: text('provider').notNull().default(''),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    total_tokens: integer('total_tokens').notNull().default(0),
    cost_usd: real('cost_usd'),
    tools_called: text('tools_called').notNull().default('[]'),
    result: text('result', { enum: ['success', 'failure', 'partial'] }).notNull(),
    duration_ms: integer('duration_ms').notNull().default(0),
    user_id: text('user_id'),
    tenant_id: text('tenant_id'),
    source: text('source', { enum: ['web', 'mcp', 'auto-recovery', 'monitor'] }),
    created_at: text('created_at').notNull().default(''),
  },
  (table) => [
    index('idx_ai_usage_log_project').on(table.project_id),
    index('idx_ai_usage_log_created_at').on(table.created_at),
  ],
);

export const actionRuns = sqliteTable(
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

export const deploymentPatterns = sqliteTable(
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

export const opsIncidents = sqliteTable(
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
    created_at: integer('created_at').notNull(),
    resolved_at: integer('resolved_at'),
    escalated_at: integer('escalated_at'),
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

export const opsIncidentEvents = sqliteTable(
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
    created_at: integer('created_at').notNull(),
  },
  (table) => [
    check(
      'ops_incident_events_type_check',
      sql`${table.event_type} IN ('detected', 'diagnosed', 'action_taken', 'recovered', 'escalated', 'alert_sent', 'interrupted', 'cascade_detected')`,
    ),
    index('idx_ops_incident_events_incident').on(table.incident_id),
  ],
);

export const circuitBreakerState = sqliteTable(
  'circuit_breaker_state',
  {
    project_id: text('project_id').primaryKey(),
    failure_count: integer('failure_count').notNull().default(0),
    last_failure_at: integer('last_failure_at'),
    opened_at: integer('opened_at'),
    state: text('state', { enum: ['closed', 'open', 'half_open'] })
      .notNull()
      .default('closed'),
    reset_at: integer('reset_at'),
  },
  (table) => [
    check('circuit_breaker_state_check', sql`${table.state} IN ('closed', 'open', 'half_open')`),
  ],
);

export const projectDependencies = sqliteTable(
  'project_dependencies',
  {
    id: text('id').notNull().primaryKey(),
    source_project_id: text('source_project_id').notNull(),
    target_project_id: text('target_project_id'),
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
    index('idx_project_dependencies_source').on(table.source_project_id),
    index('idx_project_dependencies_target_project').on(table.target_project_id),
    index('idx_project_dependencies_target_service').on(table.target_service_id),
  ],
);

export type ProjectDependencyRow = typeof projectDependencies.$inferSelect;
export type NewProjectDependency = typeof projectDependencies.$inferInsert;
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

export const activityLog = sqliteTable(
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
  secretFiles,
  deployPlans,
  auth,
  aiUsageLog,
  actionRuns,
  deploymentPatterns,
  opsIncidents,
  opsIncidentEvents,
  circuitBreakerState,
  projectDependencies,
  activityLog,
};
