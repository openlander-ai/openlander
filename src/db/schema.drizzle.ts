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

export const projectEnvironments = pgTable(
  'project_environments',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    display_name: text('display_name').notNull(),
    tier: text('tier', { enum: ['development', 'validation', 'production'] }).notNull(),
    promotion_order: integer('promotion_order').notNull(),
    health_timeout_seconds: integer('health_timeout_seconds').notNull().default(30),
    smoke_path: text('smoke_path'),
    soak_seconds: integer('soak_seconds').notNull().default(0),
    manifest_sha256: text('manifest_sha256').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('project_environments_key_unique').on(table.project_id, table.key),
    uniqueIndex('project_environments_order_unique').on(table.project_id, table.promotion_order),
    check(
      'project_environments_tier_check',
      sql`${table.tier} IN ('development', 'validation', 'production')`,
    ),
    check('project_environments_order_check', sql`${table.promotion_order} >= 0`),
    check(
      'project_environments_health_timeout_check',
      sql`${table.health_timeout_seconds} BETWEEN 1 AND 600`,
    ),
    check(
      'project_environments_smoke_path_check',
      sql`${table.smoke_path} IS NULL OR left(${table.smoke_path}, 1) = '/'`,
    ),
    check('project_environments_soak_seconds_check', sql`${table.soak_seconds} BETWEEN 0 AND 3600`),
    check('project_environments_manifest_sha256_check', sql`length(${table.manifest_sha256}) = 64`),
    index('idx_project_environments_project').on(table.project_id, table.promotion_order),
  ],
);

export const projectManifestStates = pgTable(
  'project_manifest_states',
  {
    project_id: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    manifest_path: text('manifest_path').notNull(),
    manifest_sha256: text('manifest_sha256').notNull(),
    definition_json: jsonb('definition_json').$type<Record<string, unknown>>().notNull(),
    applied_by: text('applied_by').notNull(),
    applied_at: text('applied_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'project_manifest_states_manifest_sha256_check',
      sql`length(${table.manifest_sha256}) = 64`,
    ),
  ],
);

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    /** Post-0012: canonical FK is service_id; legacy project_id dropped. */
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    project_environment_id: text('project_environment_id').references(
      () => projectEnvironments.id,
      { onDelete: 'cascade' },
    ),
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
    uniqueIndex('environments_service_project_environment_unique')
      .on(table.service_id, table.project_environment_id)
      .where(sql`${table.project_environment_id} IS NOT NULL`),
    uniqueIndex('environments_service_type_legacy_unique')
      .on(table.service_id, table.type)
      .where(sql`${table.project_environment_id} IS NULL`),
    index('idx_environments_service').on(table.service_id),
    index('idx_environments_project_environment').on(table.project_environment_id),
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
      .where(sql`${table.service_id} IS NOT NULL AND ${table.environment_id} IS NULL`),
    uniqueIndex('env_vars_service_environment_key_unique')
      .on(table.service_id, table.environment_id, table.key)
      .where(sql`${table.service_id} IS NOT NULL AND ${table.environment_id} IS NOT NULL`),
    uniqueIndex('env_vars_project_group_key_unique')
      .on(table.project_id, table.key)
      .where(sql`${table.service_id} IS NULL AND ${table.environment_id} IS NULL`),
    uniqueIndex('env_vars_project_environment_key_unique')
      .on(table.project_id, table.environment_id, table.key)
      .where(sql`${table.service_id} IS NULL AND ${table.environment_id} IS NOT NULL`),
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
    representative_traffic_json: text('representative_traffic_json'),
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
    domain: text('domain').notNull(),
    cloudflare_zone_id: text('cloudflare_zone_id'),
    cloudflare_dns_record_id: text('cloudflare_dns_record_id'),
    status: text('status', { enum: ['active', 'pending', 'error'] }).default('active'),
    path_prefix: text('path_prefix').notNull().default('/'),
    strip_prefix: boolean('strip_prefix').notNull().default(false),
    upstream_path_prefix: text('upstream_path_prefix'),
    target_port: integer('target_port'),
    // v0.1 does not enable ACME routing. NULL means "unspecified until the
    // v0.2 TLS model lands"; true/false remain reserved for that contract.
    tls_enabled: boolean('tls_enabled'),
    tls_resolver: text('tls_resolver'),
    created_at: text('created_at').default(sql`now()::text`),
    updated_at: text('updated_at').default(sql`now()::text`),
  },
  (table) => [
    check('domain_mappings_status_check', sql`${table.status} IN ('active', 'pending', 'error')`),
    check('domain_mappings_path_prefix_check', sql`${table.path_prefix} LIKE '/%'`),
    check(
      'domain_mappings_target_port_check',
      sql`${table.target_port} IS NULL OR (${table.target_port} >= 1 AND ${table.target_port} <= 65535)`,
    ),
    index('idx_domain_mappings_service').on(table.service_id),
    uniqueIndex('domain_mappings_domain_path_unique').on(table.domain, table.path_prefix),
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

export const gitCredentials = pgTable(
  'git_credentials',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    provider: text('provider', { enum: ['github'] })
      .notNull()
      .default('github'),
    auth_type: text('auth_type', { enum: ['deploy_key'] })
      .notNull()
      .default('deploy_key'),
    repository_url: text('repository_url').notNull(),
    repository_key: text('repository_key').notNull(),
    public_key: text('public_key').notNull(),
    fingerprint: text('fingerprint').notNull().unique(),
    encrypted_private_key: text('encrypted_private_key').notNull(),
    private_key_iv: text('private_key_iv').notNull(),
    status: text('status', { enum: ['pending', 'verified', 'failed'] })
      .notNull()
      .default('pending'),
    default_branch: text('default_branch'),
    last_error_code: text('last_error_code'),
    verified_at: text('verified_at'),
    last_used_at: text('last_used_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check('git_credentials_provider_check', sql`${table.provider} = 'github'`),
    check('git_credentials_auth_type_check', sql`${table.auth_type} = 'deploy_key'`),
    check(
      'git_credentials_status_check',
      sql`${table.status} IN ('pending', 'verified', 'failed')`,
    ),
    index('idx_git_credentials_repository_key').on(table.repository_key),
    index('idx_git_credentials_status').on(table.status),
  ],
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
    runtime_role: text('runtime_role', {
      enum: ['application', 'job', 'resource'],
    })
      .notNull()
      .default('application'),
    // Deployable-specific (NULL for managed)
    status: text('status', { enum: ['running', 'stopped', 'error', 'recovering'] }).default(
      'stopped',
    ),
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
    git_credential_id: text('git_credential_id').references(() => gitCredentials.id, {
      onDelete: 'set null',
    }),
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
    index('idx_services_runtime_role').on(table.runtime_role),
    check(
      'services_runtime_role_check',
      sql`${table.runtime_role} IN ('application', 'job', 'resource')`,
    ),
    index('idx_services_git_credential').on(table.git_credential_id),
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
    scope_kind: text('scope_kind', { enum: ['org', 'project', 'service'] }).notNull(),
    scope_project_id: text('scope_project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    scope_service_id: text('scope_service_id').references(() => services.id, {
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
    check('pat_tokens_scope_kind_check', sql`${table.scope_kind} IN ('org', 'project', 'service')`),
    check(
      'pat_tokens_type_check',
      sql`${table.token_type} IN ('pat', 'service', 'legacy-default')`,
    ),
    check(
      'pat_tokens_scope_project_check',
      sql`(${table.scope_kind} = 'org' AND ${table.scope_project_id} IS NULL AND ${table.scope_service_id} IS NULL) OR (${table.scope_kind} = 'project' AND ${table.scope_project_id} IS NOT NULL AND ${table.scope_service_id} IS NULL) OR (${table.scope_kind} = 'service' AND ${table.scope_project_id} IS NULL AND ${table.scope_service_id} IS NOT NULL)`,
    ),
    check(
      'pat_tokens_expiry_check',
      sql`${table.token_type} = 'legacy-default' OR ${table.expires_at} IS NOT NULL`,
    ),
    index('idx_pat_tokens_hash').on(table.token_hash),
    index('idx_pat_tokens_scope').on(table.scope_kind, table.scope_project_id),
    index('idx_pat_tokens_scope_service').on(table.scope_kind, table.scope_service_id),
    index('idx_pat_tokens_expires').on(table.expires_at),
  ],
);

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: text('id').notNull().primaryKey(),
    project_id: text('project_id'),
    service_id: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    feature: text('feature'),
    briefing_id: text('briefing_id'),
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
        'ai_ops_briefing',
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
    index('idx_ai_usage_log_service').on(table.service_id),
    index('idx_ai_usage_log_feature').on(table.feature),
    index('idx_ai_usage_log_briefing').on(table.briefing_id),
    index('idx_ai_usage_log_created_at').on(table.created_at),
  ],
);

export const aiOpsInstancePolicy = pgTable(
  'ai_ops_instance_policy',
  {
    id: integer('id').primaryKey().default(1),
    daily_briefing_limit: integer('daily_briefing_limit').notNull().default(200),
    fingerprint_cooldown_minutes: integer('fingerprint_cooldown_minutes').notNull().default(30),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check('ai_ops_instance_policy_singleton_check', sql`${table.id} = 1`),
    check('ai_ops_instance_policy_daily_limit_check', sql`${table.daily_briefing_limit} >= 0`),
    check('ai_ops_instance_policy_cooldown_check', sql`${table.fingerprint_cooldown_minutes} >= 0`),
  ],
);

export const aiOpsProjectPolicies = pgTable(
  'ai_ops_project_policies',
  {
    project_id: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['off', 'briefing'] })
      .notNull()
      .default('off'),
    daily_briefing_limit: integer('daily_briefing_limit').notNull().default(20),
    fingerprint_cooldown_minutes: integer('fingerprint_cooldown_minutes').notNull().default(30),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check('ai_ops_project_policies_mode_check', sql`${table.mode} IN ('off', 'briefing')`),
    check('ai_ops_project_policies_daily_limit_check', sql`${table.daily_briefing_limit} >= 0`),
    check(
      'ai_ops_project_policies_cooldown_check',
      sql`${table.fingerprint_cooldown_minutes} >= 0`,
    ),
    index('idx_ai_ops_project_policies_mode').on(table.mode),
  ],
);

export const aiOpsServiceOverrides = pgTable(
  'ai_ops_service_overrides',
  {
    service_id: text('service_id')
      .primaryKey()
      .references(() => services.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['inherit', 'off', 'briefing'] })
      .notNull()
      .default('inherit'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'ai_ops_service_overrides_mode_check',
      sql`${table.mode} IN ('inherit', 'off', 'briefing')`,
    ),
    index('idx_ai_ops_service_overrides_mode').on(table.mode),
  ],
);

export const aiOpsDedupe = pgTable(
  'ai_ops_dedupe',
  {
    id: text('id').primaryKey(),
    dedupe_key: text('dedupe_key').notNull(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    service_id: text('service_id').references(() => services.id, { onDelete: 'cascade' }),
    resource_kind: text('resource_kind'),
    resource_id: text('resource_id'),
    fingerprint: text('fingerprint').notNull(),
    first_seen_at: text('first_seen_at')
      .notNull()
      .default(sql`now()::text`),
    last_seen_at: text('last_seen_at')
      .notNull()
      .default(sql`now()::text`),
    cooldown_until: text('cooldown_until').notNull(),
    occurrences: integer('occurrences').notNull().default(1),
    last_briefing_id: text('last_briefing_id'),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    uniqueIndex('ai_ops_dedupe_key_unique').on(table.dedupe_key),
    index('idx_ai_ops_dedupe_project').on(table.project_id),
    index('idx_ai_ops_dedupe_service').on(table.service_id),
    index('idx_ai_ops_dedupe_cooldown').on(table.cooldown_until),
  ],
);

export const aiOpsBriefings = pgTable(
  'ai_ops_briefings',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    service_id: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    dedupe_key: text('dedupe_key'),
    fingerprint: text('fingerprint').notNull(),
    classification: text('classification').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'high', 'critical'] }).notNull(),
    title: text('title').notNull(),
    deterministic_summary: text('deterministic_summary').notNull(),
    llm_summary: text('llm_summary'),
    llm_summary_status: text('llm_summary_status', { enum: ['llm', 'fallback', 'skipped'] }),
    llm_summary_finish_reason: text('llm_summary_finish_reason'),
    llm_summary_truncated: boolean('llm_summary_truncated'),
    llm_summary_error: text('llm_summary_error'),
    llm_summary_usage_json: text('llm_summary_usage_json'),
    suggested_call_json: text('suggested_call_json'),
    evidence_json: text('evidence_json').notNull(),
    status: text('status', { enum: ['open', 'acknowledged', 'resolved'] })
      .notNull()
      .default('open'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check(
      'ai_ops_briefings_severity_check',
      sql`${table.severity} IN ('info', 'warning', 'high', 'critical')`,
    ),
    check(
      'ai_ops_briefings_status_check',
      sql`${table.status} IN ('open', 'acknowledged', 'resolved')`,
    ),
    check(
      'ai_ops_briefings_llm_summary_status_check',
      sql`${table.llm_summary_status} IS NULL OR ${table.llm_summary_status} IN ('llm', 'fallback', 'skipped')`,
    ),
    index('idx_ai_ops_briefings_project').on(table.project_id, table.created_at),
    index('idx_ai_ops_briefings_service').on(table.service_id, table.created_at),
    index('idx_ai_ops_briefings_status').on(table.status, table.created_at),
    index('idx_ai_ops_briefings_dedupe').on(table.dedupe_key),
  ],
);

export const aiOpsPendingInputs = pgTable(
  'ai_ops_pending_inputs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    briefing_id: text('briefing_id').references(() => aiOpsBriefings.id, {
      onDelete: 'set null',
    }),
    field: text('field').notNull(),
    reason: text('reason').notNull(),
    source_required: text('source_required', { enum: ['user'] })
      .notNull()
      .default('user'),
    status: text('status', { enum: ['pending', 'resolved', 'dismissed'] })
      .notNull()
      .default('pending'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
    resolved_at: text('resolved_at'),
  },
  (table) => [
    check('ai_ops_pending_inputs_source_required_check', sql`${table.source_required} IN ('user')`),
    check(
      'ai_ops_pending_inputs_status_check',
      sql`${table.status} IN ('pending', 'resolved', 'dismissed')`,
    ),
    uniqueIndex('ai_ops_pending_inputs_active_unique')
      .on(table.service_id, table.field)
      .where(sql`${table.status} = 'pending'`),
    index('idx_ai_ops_pending_inputs_project_status').on(table.project_id, table.status),
    index('idx_ai_ops_pending_inputs_service_status').on(table.service_id, table.status),
    index('idx_ai_ops_pending_inputs_briefing').on(table.briefing_id),
  ],
);

export const dataSourceAccess = pgTable(
  'data_source_access',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    environment_id: text('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    mode: text('mode', { enum: ['disabled', 'read'] })
      .notNull()
      .default('disabled'),
    reader_username: text('reader_username'),
    reader_password_encrypted: text('reader_password_encrypted'),
    reader_password_iv: text('reader_password_iv'),
    enabled_at: text('enabled_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
    server_id: text('server_id').notNull().default('local'),
  },
  (table) => [
    check('data_source_access_mode_check', sql`${table.mode} IN ('disabled', 'read')`),
    uniqueIndex('data_source_access_project_service_idx').on(table.project_id, table.service_id),
    index('idx_data_source_access_project').on(table.project_id),
    index('idx_data_source_access_service').on(table.service_id),
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

export type ServiceTableRow = typeof services.$inferSelect;
export type NewServiceTableRow = typeof services.$inferInsert;
export type ProjectTableRow = typeof projects.$inferSelect;
export type NewProjectTableRow = typeof projects.$inferInsert;
export type DeployLogTableRow = typeof deployLogs.$inferSelect;
export type EnvironmentTableRow = typeof environments.$inferSelect;

export type ProjectDependencyRow = typeof projectDependencies.$inferSelect;
export type NewProjectDependency = typeof projectDependencies.$inferInsert;
export type PatTokenRow = typeof patTokens.$inferSelect;
export type NewPatToken = typeof patTokens.$inferInsert;
export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLog.$inferInsert;
export type AiOpsInstancePolicyRow = typeof aiOpsInstancePolicy.$inferSelect;
export type NewAiOpsInstancePolicy = typeof aiOpsInstancePolicy.$inferInsert;
export type AiOpsProjectPolicyRow = typeof aiOpsProjectPolicies.$inferSelect;
export type NewAiOpsProjectPolicy = typeof aiOpsProjectPolicies.$inferInsert;
export type AiOpsServiceOverrideRow = typeof aiOpsServiceOverrides.$inferSelect;
export type NewAiOpsServiceOverride = typeof aiOpsServiceOverrides.$inferInsert;
export type AiOpsDedupeRow = typeof aiOpsDedupe.$inferSelect;
export type NewAiOpsDedupe = typeof aiOpsDedupe.$inferInsert;
export type AiOpsBriefingRow = typeof aiOpsBriefings.$inferSelect;
export type NewAiOpsBriefing = typeof aiOpsBriefings.$inferInsert;
export type AiOpsPendingInputRow = typeof aiOpsPendingInputs.$inferSelect;
export type NewAiOpsPendingInput = typeof aiOpsPendingInputs.$inferInsert;
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

export const engagements = pgTable(
  'engagements',
  {
    id: text('id').primaryKey(),
    customer_name: text('customer_name').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    status: text('status', {
      enum: ['active', 'on_hold', 'completed', 'archived'],
    })
      .notNull()
      .default('active'),
    created_by: text('created_by').notNull().default('admin'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'engagements_status_check',
      sql`${table.status} IN ('active', 'on_hold', 'completed', 'archived')`,
    ),
    check('engagements_customer_name_check', sql`length(trim(${table.customer_name})) > 0`),
    check('engagements_title_check', sql`length(trim(${table.title})) > 0`),
    index('idx_engagements_status_updated').on(table.status, table.updated_at),
  ],
);

export const engagementProjects = pgTable(
  'engagement_projects',
  {
    project_id: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    engagement_id: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    linked_by: text('linked_by').notNull().default('admin'),
    linked_at: text('linked_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [index('idx_engagement_projects_engagement').on(table.engagement_id, table.linked_at)],
);

export const artifactBlobs = pgTable(
  'artifact_blobs',
  {
    id: text('id').primaryKey(),
    sha256: text('sha256').notNull().unique(),
    mime_type: text('mime_type').notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storage_key: text('storage_key').notNull().unique(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check('artifact_blobs_size_check', sql`${table.size_bytes} >= 0`),
    check('artifact_blobs_sha256_check', sql`length(${table.sha256}) = 64`),
  ],
);

export const projectDeliverySettings = pgTable(
  'project_delivery_settings',
  {
    project_id: text('project_id')
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    organization_name: text('organization_name'),
    document_name: text('document_name').notNull().default('Delivery Receipt'),
    primary_color: text('primary_color').notNull().default('#2563EB'),
    logo_blob_id: text('logo_blob_id').references(() => artifactBlobs.id, {
      onDelete: 'set null',
    }),
    footer_text: text('footer_text'),
    locale: text('locale', { enum: ['ko', 'en'] })
      .notNull()
      .default('ko'),
    default_gates_json: jsonb('default_gates_json')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check('project_delivery_settings_locale_check', sql`${table.locale} IN ('ko', 'en')`),
    check(
      'project_delivery_settings_primary_color_check',
      sql`${table.primary_color} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    objective: text('objective').notNull().default(''),
    definition_of_done: jsonb('definition_of_done').$type<string[]>().notNull().default([]),
    manifest_path: text('manifest_path'),
    auto_finalize: boolean('auto_finalize').notNull().default(true),
    delivery_type: text('delivery_type', {
      enum: ['software_release', 'artifact_delivery'],
    })
      .notNull()
      .default('software_release'),
    maturity: text('maturity', {
      enum: ['concept', 'functional_preview', 'customer_review', 'release_candidate', 'production'],
    })
      .notNull()
      .default('customer_review'),
    status: text('status', {
      enum: [
        'draft',
        'in_review',
        'revision_requested',
        'approved',
        'ready',
        'delivered',
        'cancelled',
      ],
    })
      .notNull()
      .default('draft'),
    evidence_version: integer('evidence_version').notNull().default(0),
    previewed_evidence_version: integer('previewed_evidence_version'),
    limitations: text('limitations'),
    predecessor_delivery_id: text('predecessor_delivery_id').references(
      (): AnyPgColumn => deliveries.id,
      { onDelete: 'set null' },
    ),
    created_by: text('created_by').notNull().default('admin'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'deliveries_type_check',
      sql`${table.delivery_type} IN ('software_release', 'artifact_delivery')`,
    ),
    check(
      'deliveries_maturity_check',
      sql`${table.maturity} IN ('concept', 'functional_preview', 'customer_review', 'release_candidate', 'production')`,
    ),
    check(
      'deliveries_status_check',
      sql`${table.status} IN ('draft', 'in_review', 'revision_requested', 'approved', 'ready', 'delivered', 'cancelled')`,
    ),
    check('deliveries_evidence_version_check', sql`${table.evidence_version} >= 0`),
    check(
      'deliveries_previewed_evidence_version_check',
      sql`${table.previewed_evidence_version} IS NULL OR ${table.previewed_evidence_version} >= 0`,
    ),
    index('idx_deliveries_project').on(table.project_id, table.created_at),
    index('idx_deliveries_status').on(table.project_id, table.status),
  ],
);

export const deliveryArtifacts = pgTable(
  'delivery_artifacts',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    blob_id: text('blob_id')
      .notNull()
      .references(() => artifactBlobs.id, { onDelete: 'restrict' }),
    logical_key: text('logical_key').notNull(),
    revision: integer('revision').notNull(),
    kind: text('kind', {
      enum: [
        'review_html',
        'companion_pdf',
        'markdown',
        'qa_report',
        'data_report',
        'image',
        'other',
      ],
    }).notNull(),
    original_filename: text('original_filename').notNull(),
    status: text('status', { enum: ['draft', 'approved', 'superseded'] })
      .notNull()
      .default('draft'),
    companion_pdf_artifact_id: text('companion_pdf_artifact_id').references(
      (): AnyPgColumn => deliveryArtifacts.id,
      { onDelete: 'set null' },
    ),
    include_in_receipt: boolean('include_in_receipt').notNull().default(true),
    receipt_order: integer('receipt_order').notNull().default(0),
    idempotency_key: text('idempotency_key'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_artifacts_logical_kind_revision_unique').on(
      table.delivery_id,
      table.logical_key,
      table.kind,
      table.revision,
    ),
    uniqueIndex('delivery_artifacts_idempotency_unique')
      .on(table.delivery_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    check(
      'delivery_artifacts_kind_check',
      sql`${table.kind} IN ('review_html', 'companion_pdf', 'markdown', 'qa_report', 'data_report', 'image', 'other')`,
    ),
    check(
      'delivery_artifacts_status_check',
      sql`${table.status} IN ('draft', 'approved', 'superseded')`,
    ),
    check('delivery_artifacts_revision_check', sql`${table.revision} > 0`),
    index('idx_delivery_artifacts_delivery').on(table.delivery_id, table.receipt_order),
  ],
);

export const deliveryReviewPackages = pgTable(
  'delivery_review_packages',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status', {
      enum: ['draft', 'published', 'superseded', 'aborted', 'expired'],
    })
      .notNull()
      .default('draft'),
    manifest_sha256: text('manifest_sha256').notNull(),
    base_evidence_version: integer('base_evidence_version').notNull(),
    source_run_id: text('source_run_id').references((): AnyPgColumn => deliveryAgentRuns.id, {
      onDelete: 'set null',
    }),
    review_gate_key: text('review_gate_key').notNull().default('review'),
    review_note: text('review_note').notNull(),
    overview_mode: text('overview_mode', { enum: ['update', 'keep'] }).notNull(),
    overview_patch: jsonb('overview_patch').$type<{
      title?: string;
      summary?: string;
      limitations?: string | null;
    }>(),
    overview_keep_reason: text('overview_keep_reason'),
    overview_before_sha256: text('overview_before_sha256').notNull(),
    overview_after_sha256: text('overview_after_sha256').notNull(),
    expires_at: text('expires_at').notNull(),
    published_at: text('published_at'),
    created_by: text('created_by').notNull().default('external-agent'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_review_packages_delivery_revision_unique').on(
      table.delivery_id,
      table.revision,
    ),
    uniqueIndex('delivery_review_packages_active_draft_unique')
      .on(table.delivery_id)
      .where(sql`${table.status} = 'draft'`),
    uniqueIndex('delivery_review_packages_current_published_unique')
      .on(table.delivery_id)
      .where(sql`${table.status} = 'published'`),
    check(
      'delivery_review_packages_status_check',
      sql`${table.status} IN ('draft', 'published', 'superseded', 'aborted', 'expired')`,
    ),
    check('delivery_review_packages_revision_check', sql`${table.revision} > 0`),
    check(
      'delivery_review_packages_manifest_sha256_check',
      sql`length(${table.manifest_sha256}) = 64`,
    ),
    check(
      'delivery_review_packages_base_evidence_version_check',
      sql`${table.base_evidence_version} >= 0`,
    ),
    check(
      'delivery_review_packages_overview_mode_check',
      sql`${table.overview_mode} IN ('update', 'keep')`,
    ),
    index('idx_delivery_review_packages_delivery').on(table.delivery_id, table.created_at),
  ],
);

export const deliveryReviewPackageItems = pgTable(
  'delivery_review_package_items',
  {
    id: text('id').primaryKey(),
    package_id: text('package_id')
      .notNull()
      .references(() => deliveryReviewPackages.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['review_document', 'interactive_preview', 'representative_image'],
    }).notNull(),
    filename: text('filename').notNull(),
    expected_sha256: text('expected_sha256').notNull(),
    expected_size_bytes: bigint('expected_size_bytes', { mode: 'number' }).notNull(),
    expected_mime_type: text('expected_mime_type').notNull(),
    required: boolean('required').notNull().default(true),
    blob_id: text('blob_id').references(() => artifactBlobs.id, { onDelete: 'set null' }),
    artifact_id: text('artifact_id').references(() => deliveryArtifacts.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ['pending', 'uploaded', 'failed'] })
      .notNull()
      .default('pending'),
    attempt_count: integer('attempt_count').notNull().default(0),
    actual_sha256: text('actual_sha256'),
    actual_size_bytes: bigint('actual_size_bytes', { mode: 'number' }),
    actual_mime_type: text('actual_mime_type'),
    last_error_code: text('last_error_code'),
    last_error_details: jsonb('last_error_details').$type<Record<string, unknown>>(),
    uploaded_at: text('uploaded_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_review_package_items_role_unique').on(table.package_id, table.role),
    check(
      'delivery_review_package_items_role_check',
      sql`${table.role} IN ('review_document', 'interactive_preview', 'representative_image')`,
    ),
    check(
      'delivery_review_package_items_status_check',
      sql`${table.status} IN ('pending', 'uploaded', 'failed')`,
    ),
    check(
      'delivery_review_package_items_expected_sha256_check',
      sql`length(${table.expected_sha256}) = 64`,
    ),
    check(
      'delivery_review_package_items_expected_size_check',
      sql`${table.expected_size_bytes} > 0`,
    ),
    check('delivery_review_package_items_attempt_count_check', sql`${table.attempt_count} >= 0`),
    index('idx_delivery_review_package_items_package').on(table.package_id),
  ],
);

export const deliveryExternalRefs = pgTable(
  'delivery_external_refs',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    provider: text('provider', {
      enum: ['slack', 'teams', 'email', 'drive', 'github', 'other'],
    }).notNull(),
    label: text('label').notNull(),
    url: text('url').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'delivery_external_refs_provider_check',
      sql`${table.provider} IN ('slack', 'teams', 'email', 'drive', 'github', 'other')`,
    ),
    index('idx_delivery_external_refs_delivery').on(table.delivery_id),
  ],
);

export const deliveryFeedbackSources = pgTable(
  'delivery_feedback_sources',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    source_type: text('source_type', {
      enum: ['slack', 'teams', 'email', 'meeting', 'other'],
    }).notNull(),
    source_url: text('source_url'),
    author_display_name: text('author_display_name'),
    raw_text: text('raw_text').notNull(),
    occurred_at: text('occurred_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'delivery_feedback_sources_type_check',
      sql`${table.source_type} IN ('slack', 'teams', 'email', 'meeting', 'other')`,
    ),
    index('idx_delivery_feedback_sources_delivery').on(table.delivery_id),
  ],
);

export const deliveryWorkItems = pgTable(
  'delivery_work_items',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    feedback_source_id: text('feedback_source_id').references(() => deliveryFeedbackSources.id, {
      onDelete: 'set null',
    }),
    kind: text('kind', {
      enum: ['decision', 'change_request', 'question', 'note'],
    }).notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    status: text('status', {
      enum: ['proposed', 'confirmed', 'rejected', 'resolved', 'superseded'],
    })
      .notNull()
      .default('proposed'),
    is_ai_draft: boolean('is_ai_draft').notNull().default(false),
    resolution: text('resolution'),
    created_by: text('created_by').notNull().default('admin'),
    resolved_at: text('resolved_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'delivery_work_items_kind_check',
      sql`${table.kind} IN ('decision', 'change_request', 'question', 'note')`,
    ),
    check(
      'delivery_work_items_status_check',
      sql`${table.status} IN ('proposed', 'confirmed', 'rejected', 'resolved', 'superseded')`,
    ),
    index('idx_delivery_work_items_delivery').on(table.delivery_id, table.status),
    index('idx_delivery_work_items_feedback').on(table.feedback_source_id),
  ],
);

export const projectUpdates = pgTable(
  'project_updates',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    delivery_id: text('delivery_id').references(() => deliveries.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    occurred_at: text('occurred_at').notNull(),
    sources: jsonb('sources')
      .$type<
        Array<{
          source_type: 'repository' | 'url' | 'meeting' | 'wbs' | 'other';
          label: string;
          locator?: string;
          revision?: string;
          sha256?: string;
          artifact_id?: string;
        }>
      >()
      .notNull(),
    created_by: text('created_by').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    index('idx_project_updates_project_occurred').on(table.project_id, table.occurred_at),
    index('idx_project_updates_delivery').on(table.delivery_id),
    check('project_updates_summary_check', sql`length(trim(${table.summary})) > 0`),
    check(
      'project_updates_sources_check',
      sql`CASE WHEN jsonb_typeof(${table.sources}) = 'array' THEN jsonb_array_length(${table.sources}) BETWEEN 1 AND 20 ELSE false END`,
    ),
  ],
);

export const projectUpdateItems = pgTable(
  'project_update_items',
  {
    id: text('id').primaryKey(),
    project_update_id: text('project_update_id')
      .notNull()
      .references(() => projectUpdates.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['decision', 'action', 'risk', 'question', 'dependency', 'progress', 'fact'],
    }).notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    status: text('status', {
      enum: ['open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded'],
    }).notNull(),
    resolution_update_id: text('resolution_update_id').references(
      (): AnyPgColumn => projectUpdates.id,
      {
        onDelete: 'set null',
      },
    ),
    resolution_note: text('resolution_note'),
    resolved_at: text('resolved_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    index('idx_project_update_items_update').on(table.project_update_id),
    index('idx_project_update_items_status_kind').on(table.status, table.kind, table.updated_at),
    index('idx_project_update_items_resolution').on(table.resolution_update_id),
    check(
      'project_update_items_kind_check',
      sql`${table.kind} IN ('decision', 'action', 'risk', 'question', 'dependency', 'progress', 'fact')`,
    ),
    check(
      'project_update_items_status_check',
      sql`${table.status} IN ('open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded')`,
    ),
  ],
);

export const deliveryProjectUpdateItems = pgTable(
  'delivery_project_update_items',
  {
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    project_update_item_id: text('project_update_item_id')
      .notNull()
      .references(() => projectUpdateItems.id, { onDelete: 'cascade' }),
    item_status: text('item_status').notNull(),
    item_updated_at: text('item_updated_at').notNull(),
    linked_by: text('linked_by').notNull(),
    linked_at: text('linked_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_project_update_items_unique').on(
      table.delivery_id,
      table.project_update_item_id,
    ),
    index('idx_delivery_project_update_items_item').on(table.project_update_item_id),
    index('idx_delivery_project_update_items_delivery').on(table.delivery_id),
    check(
      'delivery_project_update_items_status_check',
      sql`${table.item_status} IN ('open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded')`,
    ),
  ],
);

export const deliveryApprovals = pgTable(
  'delivery_approvals',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    artifact_ids: jsonb('artifact_ids').$type<string[]>().notNull(),
    review_package_id: text('review_package_id').references(() => deliveryReviewPackages.id, {
      onDelete: 'set null',
    }),
    package_manifest_sha256: text('package_manifest_sha256'),
    approver_display_name: text('approver_display_name').notNull(),
    approval_excerpt: text('approval_excerpt').notNull(),
    source_type: text('source_type', {
      enum: ['slack', 'teams', 'email', 'meeting', 'other'],
    }).notNull(),
    source_url: text('source_url'),
    approved_at: text('approved_at').notNull(),
    invalidated_at: text('invalidated_at'),
    invalidated_reason: text('invalidated_reason'),
    recorded_by: text('recorded_by').notNull().default('admin'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'delivery_approvals_source_type_check',
      sql`${table.source_type} IN ('slack', 'teams', 'email', 'meeting', 'other')`,
    ),
    index('idx_delivery_approvals_delivery').on(table.delivery_id, table.approved_at),
    check(
      'delivery_approvals_package_manifest_sha256_check',
      sql`${table.package_manifest_sha256} IS NULL OR length(${table.package_manifest_sha256}) = 64`,
    ),
  ],
);

export const deliveryGates = pgTable(
  'delivery_gates',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    gate_key: text('gate_key').notNull(),
    source: text('source', { enum: ['manual', 'manifest'] })
      .notNull()
      .default('manual'),
    definition_sha256: text('definition_sha256'),
    gate_type: text('gate_type', { enum: ['review', 'qa', 'data', 'custom'] }).notNull(),
    label: text('label').notNull(),
    required: boolean('required').notNull().default(false),
    status: text('status', {
      enum: ['pending', 'passed', 'warning', 'failed', 'waived'],
    })
      .notNull()
      .default('pending'),
    summary: text('summary'),
    waiver_reason: text('waiver_reason'),
    warning_accepted: boolean('warning_accepted').notNull().default(false),
    report_artifact_id: text('report_artifact_id').references(() => deliveryArtifacts.id, {
      onDelete: 'set null',
    }),
    review_package_id: text('review_package_id').references(() => deliveryReviewPackages.id, {
      onDelete: 'set null',
    }),
    idempotency_key: text('idempotency_key'),
    recorded_by: text('recorded_by').notNull().default('admin'),
    recorded_at: text('recorded_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_gates_key_unique').on(table.delivery_id, table.gate_key),
    uniqueIndex('delivery_gates_idempotency_unique')
      .on(table.delivery_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
    check(
      'delivery_gates_type_check',
      sql`${table.gate_type} IN ('review', 'qa', 'data', 'custom')`,
    ),
    check(
      'delivery_gates_status_check',
      sql`${table.status} IN ('pending', 'passed', 'warning', 'failed', 'waived')`,
    ),
    check('delivery_gates_source_check', sql`${table.source} IN ('manual', 'manifest')`),
    check(
      'delivery_gates_definition_sha256_check',
      sql`${table.definition_sha256} IS NULL OR length(${table.definition_sha256}) = 64`,
    ),
    index('idx_delivery_gates_delivery').on(table.delivery_id),
  ],
);

export const applicationOperationInvocations = pgTable(
  'application_operation_invocations',
  {
    id: text('id').primaryKey(),
    operation_name: text('operation_name').notNull(),
    operation_version: integer('operation_version').notNull(),
    actor_scope_key: text('actor_scope_key').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    request_sha256: text('request_sha256').notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed'] })
      .notNull()
      .default('running'),
    response_json: jsonb('response_json').$type<Record<string, unknown>>(),
    error_json: jsonb('error_json').$type<Record<string, unknown>>(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('application_operation_invocations_key_unique').on(
      table.operation_name,
      table.operation_version,
      table.actor_scope_key,
      table.idempotency_key,
    ),
    check(
      'application_operation_invocations_status_check',
      sql`${table.status} IN ('running', 'succeeded', 'failed')`,
    ),
    check(
      'application_operation_invocations_request_sha256_check',
      sql`length(${table.request_sha256}) = 64`,
    ),
    index('idx_application_operation_invocations_created').on(
      table.operation_name,
      table.created_at,
    ),
  ],
);

export const deliveryAgentRuns = pgTable(
  'delivery_agent_runs',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'paused', 'completed', 'failed', 'cancelled'] })
      .notNull()
      .default('running'),
    commit_sha: text('commit_sha').notNull(),
    manifest_path: text('manifest_path').notNull(),
    manifest_sha256: text('manifest_sha256').notNull(),
    runner_image: text('runner_image').notNull(),
    runner_image_digest: text('runner_image_digest'),
    current_phase: text('current_phase').notNull().default('planning'),
    handoff_summary: text('handoff_summary'),
    started_by: text('started_by').notNull(),
    started_at: text('started_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
    completed_at: text('completed_at'),
    cancellation_reason: text('cancellation_reason'),
  },
  (table) => [
    check(
      'delivery_agent_runs_status_check',
      sql`${table.status} IN ('running', 'paused', 'completed', 'failed', 'cancelled')`,
    ),
    check('delivery_agent_runs_commit_sha_check', sql`length(trim(${table.commit_sha})) > 0`),
    check('delivery_agent_runs_manifest_sha256_check', sql`length(${table.manifest_sha256}) = 64`),
    uniqueIndex('delivery_agent_runs_active_unique')
      .on(table.delivery_id)
      .where(sql`${table.status} IN ('running', 'paused')`),
    index('idx_delivery_agent_runs_delivery').on(table.delivery_id, table.started_at),
  ],
);

export const deliveryAgentRunEvents = pgTable(
  'delivery_agent_run_events',
  {
    id: text('id').primaryKey(),
    run_id: text('run_id')
      .notNull()
      .references(() => deliveryAgentRuns.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    event_type: text('event_type').notNull(),
    phase: text('phase'),
    summary: text('summary').notNull(),
    detail_json: jsonb('detail_json').$type<Record<string, unknown>>().notNull().default({}),
    actor: text('actor').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_agent_run_events_sequence_unique').on(table.run_id, table.sequence),
    check('delivery_agent_run_events_sequence_check', sql`${table.sequence} > 0`),
    index('idx_delivery_agent_run_events_run').on(table.run_id, table.created_at),
  ],
);

export const deliveryRunChecks = pgTable(
  'delivery_run_checks',
  {
    id: text('id').primaryKey(),
    run_id: text('run_id')
      .notNull()
      .references(() => deliveryAgentRuns.id, { onDelete: 'cascade' }),
    gate_id: text('gate_id').references(() => deliveryGates.id, { onDelete: 'set null' }),
    check_key: text('check_key').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: text('status', { enum: ['pending', 'running', 'passed', 'failed', 'cancelled'] })
      .notNull()
      .default('pending'),
    command: text('command').notNull(),
    exit_code: integer('exit_code'),
    duration_ms: integer('duration_ms'),
    log_sha256: text('log_sha256'),
    report_artifact_id: text('report_artifact_id').references(() => deliveryArtifacts.id, {
      onDelete: 'set null',
    }),
    runner_image_digest: text('runner_image_digest'),
    details_json: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
    started_at: text('started_at'),
    finished_at: text('finished_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_run_checks_attempt_unique').on(
      table.run_id,
      table.check_key,
      table.attempt,
    ),
    check('delivery_run_checks_attempt_check', sql`${table.attempt} > 0`),
    check(
      'delivery_run_checks_status_check',
      sql`${table.status} IN ('pending', 'running', 'passed', 'failed', 'cancelled')`,
    ),
    check(
      'delivery_run_checks_duration_check',
      sql`${table.duration_ms} IS NULL OR ${table.duration_ms} >= 0`,
    ),
    check(
      'delivery_run_checks_log_sha256_check',
      sql`${table.log_sha256} IS NULL OR length(${table.log_sha256}) = 64`,
    ),
    index('idx_delivery_run_checks_run').on(table.run_id, table.check_key, table.attempt),
    index('idx_delivery_run_checks_gate').on(table.gate_id),
  ],
);

export const releases = pgTable(
  'releases',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    agent_run_id: text('agent_run_id')
      .notNull()
      .references(() => deliveryAgentRuns.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    commit_sha: text('commit_sha').notNull(),
    status: text('status', { enum: ['building', 'ready', 'recalled', 'failed'] })
      .notNull()
      .default('building'),
    created_by: text('created_by').notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('releases_delivery_version_unique').on(table.delivery_id, table.version),
    check(
      'releases_status_check',
      sql`${table.status} IN ('building', 'ready', 'recalled', 'failed')`,
    ),
    check('releases_commit_sha_check', sql`length(${table.commit_sha}) IN (40, 64)`),
    index('idx_releases_delivery').on(table.delivery_id, table.created_at),
  ],
);

export const releaseArtifacts = pgTable(
  'release_artifacts',
  {
    id: text('id').primaryKey(),
    release_id: text('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    service_id: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    image_reference: text('image_reference').notNull(),
    image_digest: text('image_digest').notNull(),
    build_provenance: jsonb('build_provenance').$type<Record<string, unknown>>().notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('release_artifacts_service_unique').on(table.release_id, table.service_id),
    check(
      'release_artifacts_digest_check',
      sql`${table.image_digest} ~ '^sha256:[0-9A-Fa-f]{64}$'`,
    ),
    index('idx_release_artifacts_release').on(table.release_id),
  ],
);

export const releasePromotions = pgTable(
  'release_promotions',
  {
    id: text('id').primaryKey(),
    release_id: text('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    project_environment_id: text('project_environment_id')
      .notNull()
      .references(() => projectEnvironments.id, { onDelete: 'cascade' }),
    previous_release_id: text('previous_release_id').references((): AnyPgColumn => releases.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['pending', 'deploying', 'succeeded', 'failed', 'rolled_back'],
    })
      .notNull()
      .default('pending'),
    health_status: text('health_status', {
      enum: ['pending', 'healthy', 'unhealthy'],
    })
      .notNull()
      .default('pending'),
    soak_status: text('soak_status', { enum: ['pending', 'passed', 'failed', 'skipped'] })
      .notNull()
      .default('pending'),
    deploy_ids: jsonb('deploy_ids').$type<string[]>().notNull().default([]),
    runtime_environment_ids: jsonb('runtime_environment_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    idempotency_key: text('idempotency_key').notNull(),
    error_code: text('error_code'),
    error_message: text('error_message'),
    initiated_by: text('initiated_by').notNull(),
    started_at: text('started_at'),
    completed_at: text('completed_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('release_promotions_idempotency_unique').on(
      table.project_environment_id,
      table.idempotency_key,
    ),
    check(
      'release_promotions_status_check',
      sql`${table.status} IN ('pending', 'deploying', 'succeeded', 'failed', 'rolled_back')`,
    ),
    check(
      'release_promotions_health_check',
      sql`${table.health_status} IN ('pending', 'healthy', 'unhealthy')`,
    ),
    check(
      'release_promotions_soak_check',
      sql`${table.soak_status} IN ('pending', 'passed', 'failed', 'skipped')`,
    ),
    index('idx_release_promotions_release').on(table.release_id, table.created_at),
    index('idx_release_promotions_environment').on(table.project_environment_id, table.created_at),
  ],
);

export const engagementWeeklyReports = pgTable(
  'engagement_weekly_reports',
  {
    id: text('id').primaryKey(),
    engagement_id: text('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'restrict' }),
    period_start: text('period_start').notNull(),
    period_end: text('period_end').notNull(),
    revision: integer('revision').notNull(),
    status: text('status', { enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    evidence_snapshot: jsonb('evidence_snapshot').$type<Record<string, unknown>>().notNull(),
    evidence_sha256: text('evidence_sha256').notNull(),
    internal_html_blob_id: text('internal_html_blob_id').references(() => artifactBlobs.id, {
      onDelete: 'restrict',
    }),
    internal_pdf_blob_id: text('internal_pdf_blob_id').references(() => artifactBlobs.id, {
      onDelete: 'restrict',
    }),
    customer_html_blob_id: text('customer_html_blob_id').references(() => artifactBlobs.id, {
      onDelete: 'restrict',
    }),
    customer_pdf_blob_id: text('customer_pdf_blob_id').references(() => artifactBlobs.id, {
      onDelete: 'restrict',
    }),
    internal_sha256: text('internal_sha256'),
    customer_sha256: text('customer_sha256'),
    created_by: text('created_by').notNull(),
    published_at: text('published_at'),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('engagement_weekly_reports_revision_unique').on(
      table.engagement_id,
      table.period_start,
      table.period_end,
      table.revision,
    ),
    check('engagement_weekly_reports_revision_check', sql`${table.revision} > 0`),
    check('engagement_weekly_reports_status_check', sql`${table.status} IN ('draft', 'published')`),
    check(
      'engagement_weekly_reports_evidence_sha_check',
      sql`length(${table.evidence_sha256}) = 64`,
    ),
    index('idx_engagement_weekly_reports_engagement').on(table.engagement_id, table.period_start),
  ],
);

export const deliveryIdempotencyRecords = pgTable(
  'delivery_idempotency_records',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    operation: text('operation').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    request_sha256: text('request_sha256').notNull(),
    response_json: jsonb('response_json').$type<Record<string, unknown>>().notNull(),
    created_at: text('created_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    uniqueIndex('delivery_idempotency_records_key_unique').on(
      table.delivery_id,
      table.operation,
      table.idempotency_key,
    ),
    check(
      'delivery_idempotency_records_request_sha256_check',
      sql`length(${table.request_sha256}) = 64`,
    ),
    index('idx_delivery_idempotency_records_delivery').on(table.delivery_id, table.created_at),
  ],
);

export const deliveryDeployLinks = pgTable(
  'delivery_deploy_links',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    deploy_id: text('deploy_id')
      .notNull()
      .references(() => deployLogs.id, { onDelete: 'cascade' }),
    relation: text('relation', { enum: ['candidate', 'released', 'rollback'] }).notNull(),
    linked_at: text('linked_at')
      .notNull()
      .default(sql`now()::text`),
  },
  (table) => [
    check(
      'delivery_deploy_links_relation_check',
      sql`${table.relation} IN ('candidate', 'released', 'rollback')`,
    ),
    uniqueIndex('delivery_deploy_links_unique').on(
      table.delivery_id,
      table.deploy_id,
      table.relation,
    ),
    index('idx_delivery_deploy_links_delivery').on(table.delivery_id),
  ],
);

export const deliveryReceipts = pgTable(
  'delivery_receipts',
  {
    id: text('id').primaryKey(),
    delivery_id: text('delivery_id')
      .notNull()
      .unique()
      .references(() => deliveries.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull().default(1),
    snapshot_json: jsonb('snapshot_json').$type<Record<string, unknown>>().notNull(),
    pdf_blob_id: text('pdf_blob_id')
      .notNull()
      .references(() => artifactBlobs.id, { onDelete: 'restrict' }),
    pdf_sha256: text('pdf_sha256').notNull(),
    finalized_by: text('finalized_by').notNull(),
    finalized_at: text('finalized_at').notNull(),
  },
  (table) => [
    check('delivery_receipts_revision_check', sql`${table.revision} > 0`),
    check('delivery_receipts_sha256_check', sql`length(${table.pdf_sha256}) = 64`),
  ],
);

export type ProjectDeliverySettingsRow = typeof projectDeliverySettings.$inferSelect;
export type ProjectEnvironmentRow = typeof projectEnvironments.$inferSelect;
export type ProjectManifestStateRow = typeof projectManifestStates.$inferSelect;
export type ArtifactBlobRow = typeof artifactBlobs.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryArtifactRow = typeof deliveryArtifacts.$inferSelect;
export type DeliveryReviewPackageRow = typeof deliveryReviewPackages.$inferSelect;
export type DeliveryReviewPackageItemRow = typeof deliveryReviewPackageItems.$inferSelect;
export type DeliveryExternalRefRow = typeof deliveryExternalRefs.$inferSelect;
export type DeliveryFeedbackSourceRow = typeof deliveryFeedbackSources.$inferSelect;
export type DeliveryWorkItemRow = typeof deliveryWorkItems.$inferSelect;
export type ProjectUpdateRow = typeof projectUpdates.$inferSelect;
export type ProjectUpdateItemRow = typeof projectUpdateItems.$inferSelect;
export type DeliveryProjectUpdateItemRow = typeof deliveryProjectUpdateItems.$inferSelect;
export type DeliveryApprovalRow = typeof deliveryApprovals.$inferSelect;
export type DeliveryGateRow = typeof deliveryGates.$inferSelect;
export type ApplicationOperationInvocationRow = typeof applicationOperationInvocations.$inferSelect;
export type DeliveryAgentRunRow = typeof deliveryAgentRuns.$inferSelect;
export type DeliveryAgentRunEventRow = typeof deliveryAgentRunEvents.$inferSelect;
export type DeliveryRunCheckRow = typeof deliveryRunChecks.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type ReleaseArtifactRow = typeof releaseArtifacts.$inferSelect;
export type ReleasePromotionRow = typeof releasePromotions.$inferSelect;
export type EngagementWeeklyReportRow = typeof engagementWeeklyReports.$inferSelect;
export type DeliveryIdempotencyRecordRow = typeof deliveryIdempotencyRecords.$inferSelect;
export type DeliveryDeployLinkRow = typeof deliveryDeployLinks.$inferSelect;
export type DeliveryReceiptRow = typeof deliveryReceipts.$inferSelect;
export type EngagementRow = typeof engagements.$inferSelect;
export type EngagementProjectRow = typeof engagementProjects.$inferSelect;
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
  projectEnvironments,
  projectManifestStates,
  environments,
  envVars,
  deployLogs,
  timelineEvents,
  domainMappings,
  oauthTokens,
  webhookConfigs,
  globalSecrets,
  gitCredentials,
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
  aiOpsInstancePolicy,
  aiOpsProjectPolicies,
  aiOpsServiceOverrides,
  aiOpsDedupe,
  aiOpsBriefings,
  aiOpsPendingInputs,
  dataSourceAccess,
  actionRuns,
  deploymentPatterns,
  opsIncidents,
  opsIncidentEvents,
  circuitBreakerState,
  projectDependencies,
  serviceMetrics,
  settings,
  activityLog,
  engagements,
  engagementProjects,
  artifactBlobs,
  projectDeliverySettings,
  deliveries,
  deliveryArtifacts,
  deliveryReviewPackages,
  deliveryReviewPackageItems,
  deliveryExternalRefs,
  deliveryFeedbackSources,
  deliveryWorkItems,
  projectUpdates,
  projectUpdateItems,
  deliveryProjectUpdateItems,
  deliveryApprovals,
  deliveryGates,
  applicationOperationInvocations,
  deliveryAgentRuns,
  deliveryAgentRunEvents,
  deliveryRunChecks,
  releases,
  releaseArtifacts,
  releasePromotions,
  engagementWeeklyReports,
  deliveryIdempotencyRecords,
  deliveryDeployLinks,
  deliveryReceipts,
  mcpSessionLog,
};
