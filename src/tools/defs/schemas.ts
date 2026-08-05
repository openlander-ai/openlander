import { z } from 'zod';

import { ENVIRONMENT_KEYS } from '../../pipeline/env-scope.js';

const envVarsInputSchema = z.union([z.string().min(1), z.record(z.string(), z.string())]);

// Core project/deployment schemas
export const deployProjectSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL (e.g., github.com/user/repo)'),
  branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
  name: z.string().optional().describe('Project name (auto-generated from repo if not provided)'),
  dockerfile_path: z
    .string()
    .optional()
    .describe('Relative Dockerfile path inside the repository (e.g., frontend/Dockerfile)'),
  docker_target: z
    .string()
    .optional()
    .describe('Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)'),
  env_vars: envVarsInputSchema
    .optional()
    .describe(
      'Environment variables as an object or JSON-stringified object (e.g., {"DATABASE_URL": "...", "REDIS_URL": "..."})',
    ),
  prefer_dockerfile: z
    .boolean()
    .optional()
    .describe('Prefer Dockerfile flow and skip compose detection'),
  force: z
    .boolean()
    .optional()
    .describe(
      'Force deploy by auto-removing conflicting containers before preflight check. Use when redeploying a project that has a stale container.',
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      'Preview deployment plan without executing. Clones repo and returns detected config, Dockerfile, build context, and resource allocation — but does NOT build or deploy.',
    ),
  compose_services: z
    .array(z.string())
    .optional()
    .describe(
      'Specific docker-compose services to deploy (e.g., ["backend"]). Deploys all if omitted.',
    ),
});

export const projectNameSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const publicAccessTargetSchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Preferred Application/Compose service_id'),
    service_name: z.string().min(1).optional().describe('Application/Compose workload name'),
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Project name. Initial publish requires the Project to contain exactly one Application/Compose workload unless service_id/service_name is supplied.',
      ),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.service_id || value.service_name || value.project_id || value.project_name),
    { message: 'service_id, service_name, project_id, or project_name is required' },
  );

const monitoringTargetFields = {
  service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Application/Compose name. If no workload has that name, a Project name with exactly one workload is accepted.',
    ),
  project_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project id. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project name. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
    ),
} as const;

function monitoringTargetSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...monitoringTargetFields, ...shape })
    .refine(
      (value: Record<string, unknown>) =>
        Boolean(
          value['service_id'] ||
          value['service_name'] ||
          value['project_id'] ||
          value['project_name'] ||
          value['container_name'],
        ),
      {
        message:
          'service_id, service_name, project_id, project_name, or container_name is required',
      },
    );
}

export const getLogsSchema = monitoringTargetSchema({
  lines: z.number().int().positive().optional().describe('Number of log lines to retrieve'),
  container_name: z
    .string()
    .min(1)
    .optional()
    .describe('Docker container name for an Application/Compose workload, e.g. ol-my-worker'),
});

export const getProjectStatsSchema = monitoringTargetSchema({});

export const getTopologySchema = z
  .object({
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

export const getInstanceInfoSchema = z.object({}).strict();

export const listAiOpsBriefingsSchema = z.object({
  project_id: z.string().min(1).optional().describe('Project id'),
  service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
  status: z
    .enum(['open', 'acknowledged', 'resolved', 'unresolved'])
    .optional()
    .describe('Briefing status'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum briefings to return'),
});

export const getAiOpsBriefingSchema = z.object({
  briefing_id: z.string().min(1).describe('AI Ops briefing id'),
});

export const diagnoseServiceSchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Application/Compose name. If no workload has that name, a Project name with exactly one workload is accepted.',
      ),
    project_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Project id. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
      ),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Project name. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
      ),
    briefing_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional AI Ops briefing id to compare the incident-time snapshot with this live diagnosis and return a recovery_receipt.',
      ),
    lines: z
      .number()
      .int()
      .positive()
      .max(300)
      .optional()
      .describe('Recent container log lines to include (default: 80, max: 300).'),
    path: z
      .string()
      .optional()
      .describe('HTTP path to probe on the service assigned port (default: health path or "/").'),
    health_check_path: z.string().optional().describe('Alias for path.'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(30000)
      .optional()
      .describe('Probe timeout in milliseconds (default: 5000).'),
    internal: z
      .boolean()
      .optional()
      .describe(
        'When true, run the HTTP probe from inside the service container itself (against its container_port). Use this when the deploy reports a healthcheck failure or the host-side probe cannot reach the assigned port. Default: false (host-side probe against assigned_port).',
      ),
  })
  .refine(
    (value) =>
      Boolean(value.service_id || value.service_name || value.project_id || value.project_name),
    {
      message: 'service_id, service_name, project_id, or project_name is required',
    },
  );

export const managedServiceTargetSchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Database/Cache/Storage service_id'),
    service_name: z.string().min(1).optional().describe('Database/Cache/Storage resource name'),
  })
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

export const mcpActionStatusSchema = z
  .object({
    action_run_id: z
      .string()
      .min(1)
      .optional()
      .describe('Action run id returned by a pending MCP action'),
    action_id: z.string().min(1).optional().describe('Alias for action_run_id'),
  })
  .refine((value) => Boolean(value.action_run_id || value.action_id), {
    message: 'action_run_id or action_id is required',
  });

export const platformHealthSchema = z.object({});

export const platformEventLogSchema = z.object({
  limit: z.number().optional(),
  event_type: z.string().optional(),
  since_minutes: z.number().optional(),
});

export const platformContainerAuditSchema = z.object({
  project_name: z.string().optional(),
});

export const platformConfigSchema = z.object({
  section: z.string().optional(),
});

export const platformLogsSchema = z.object({
  limit: z.number().optional(),
  level: z.string().optional(),
  module: z.string().optional(),
  since_minutes: z.number().optional(),
});

export const platformDockerInspectSchema = z.object({
  container_id: z.string(),
});

export const platformDockerPsSchema = z.object({
  all: z.boolean().optional(),
  filter_managed: z.boolean().optional(),
});

export const platformDbInspectSchema = z.object({
  table: z.enum([
    'projects',
    'environments',
    'services',
    'deploy_logs',
    'timeline_events',
    'domain_mappings',
    'webhook_configs',
    'deploy_configs',
    'activity_log',
  ]),
  project_id: z.string().optional(),
  limit: z.number().optional(),
});

export const platformCleanupOrphansSchema = z.object({
  confirm: z.boolean().optional(),
  dry_run: z.boolean().optional().default(true),
});

export const platformReconcileSchema = z.object({
  confirm: z.boolean().optional(),
  dry_run: z.boolean().optional().default(true),
});

export const platformForceRemoveSchema = z.object({
  container_id: z.string(),
  confirm: z.boolean(),
});

export const platformRecoverSchema = z.object({
  dry_run: z.boolean().optional().describe('Preview recovery actions without executing them'),
});

const envTargetFields = {
  service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Application/Compose name. If no workload has that name, a Project name with exactly one workload is accepted.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project name. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
    ),
  project_id: z.string().min(1).optional().describe('Project id'),
} as const;

const envScopeFields = {
  scope: z
    .enum(['project', 'project_environment', 'service', 'service_environment'])
    .optional()
    .describe(
      'Optional explicit env scope. Defaults to legacy service scope. Use project_environment/service_environment with environment_key.',
    ),
  environment_key: z
    .enum(ENVIRONMENT_KEYS)
    .optional()
    .describe(
      'Logical environment for environment-scoped operations. One of production, staging, development.',
    ),
} as const;

function envTargetSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...envTargetFields, ...shape })
    .refine(
      (value: {
        service_id?: unknown;
        service_name?: unknown;
        project_name?: unknown;
        project_id?: unknown;
      }) =>
        Boolean(value.service_id || value.service_name || value.project_name || value.project_id),
      {
        message: 'service_id, service_name, or project_name is required',
      },
    );
}

// Environment & configuration schemas
export const setEnvVarsSchema = envTargetSchema({
  ...envScopeFields,
  variables: envVarsInputSchema.describe(
    'Environment variables as an object or JSON-stringified object (e.g., {"DATABASE_URL": "..."})',
  ),
  defer_redeploy: z
    .boolean()
    .optional()
    .describe('Default true. If true, save only and require an explicit redeploy to apply.'),
});

export const listEnvVarsSchema = envTargetSchema({
  ...envScopeFields,
  reveal: z.boolean().optional().describe('If true, return unmasked raw values. Default: false.'),
});

export const getEnvVarSchema = envTargetSchema({
  ...envScopeFields,
  key: z.string().min(1).describe('Environment variable key to retrieve'),
});

export const exportEnvVarsSchema = envTargetSchema({
  ...envScopeFields,
});

export const deleteEnvVarSchema = envTargetSchema({
  ...envScopeFields,
  key: z.string().min(1).describe('Environment variable key to delete'),
  defer_redeploy: z
    .boolean()
    .optional()
    .describe('Default true. If true, delete only and require an explicit redeploy to apply.'),
});

export const bulkDeleteEnvVarsSchema = envTargetSchema({
  ...envScopeFields,
  keys: z.array(z.string().min(1)).min(1).describe('Environment variable keys to delete'),
  confirm: z.boolean().optional().describe('Must be true to execute. Omit for dry-run preview.'),
  defer_redeploy: z
    .boolean()
    .optional()
    .describe('Default true. If true, delete only and require an explicit redeploy to apply.'),
});

export const setGlobalSecretSchema = z.object({
  key: z.string().min(1).describe('Secret key'),
  value: z.string().min(1).describe('Secret value'),
  description: z.string().optional().describe('Description of the secret'),
});

// Domain & networking schemas
export const domainSchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
    service_name: z.string().min(1).optional().describe('Application/Compose name'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional Project name. Legacy fallback: if service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
      ),
    domain: z.string().min(1).describe('Domain name'),
  })
  .refine((value) => Boolean(value.service_id || value.service_name || value.project_name), {
    message: 'service_id, service_name, or project_name is required',
  });

// Preview deployment schemas
export const previewDeploySchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().min(1).describe('Branch to preview'),
  git_credential_id: z.string().min(1).optional().describe('Repository Deploy Key credential ID'),
});

export const previewIdSchema = z.object({
  preview_id: z.string().min(1).describe('Preview deployment ID'),
});

// Status & monitoring schemas
export const deployStatusSchema = z.object({
  service_id: z
    .string()
    .optional()
    .describe('Application/Compose service_id for service-scoped deploy status lookup'),
  service_name: z
    .string()
    .optional()
    .describe('Application/Compose name for service-scoped deploy status lookup'),
  project_id: z.string().optional().describe('Project id for current in-flight status lookup'),
  project_name: z.string().optional().describe('Project name for current in-flight status lookup'),
  deploy_id: z.string().optional().describe('Completed deploy log id to look up'),
  job_id: z.string().optional().describe('Alias for deploy_id; also checks active in-memory jobs'),
  wait: z
    .boolean()
    .optional()
    .describe('If true, block until deploy completes instead of returning current status'),
  timeout: z
    .number()
    .optional()
    .describe('Max wait time in seconds (default 300, only used with wait=true)'),
  watch_ms: z
    .number()
    .int()
    .positive()
    .max(25000)
    .optional()
    .describe(
      'Short long-poll window in milliseconds for MCP agents. Returns current status after the window, capped at 25s.',
    ),
});

// Git & repository schemas
export const scanDockerfilesSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch to scan'),
  git_credential_id: z.string().min(1).optional().describe('Repository Deploy Key credential ID'),
});

export const orchestrateDeploySchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch'),
});

export const listGithubReposSchema = z.object({
  page: z.number().int().positive().optional().describe('Page number'),
  visibility: z
    .enum(['all', 'public', 'private'])
    .optional()
    .describe('Repository visibility filter'),
});

export const searchGithubReposSchema = z.object({
  query: z.string().min(1).describe('Search query'),
});

export const createGitDeployKeySchema = z.object({
  repo_url: z.string().min(1).describe('GitHub repository URL'),
  name: z.string().min(1).optional().describe('Display name for this repository key'),
});

export const listGitCredentialsSchema = z.object({
  repo_url: z.string().min(1).optional().describe('Filter by exact GitHub repository URL'),
  status: z.enum(['pending', 'verified', 'failed']).optional().describe('Filter by status'),
});

export const verifyGitCredentialSchema = z.object({
  credential_id: z.string().min(1).describe('Git credential ID'),
});

export const removeGitCredentialSchema = z.object({
  credential_id: z.string().min(1).describe('Git credential ID to permanently delete'),
});

// Compose & orchestration schemas
export const deployComposeSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch'),
});

export const listComposeServicesSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Service management schemas
export const createServiceSchema = z.object({
  name: z.string().min(1).describe('Service name'),
  template: z
    .string()
    .optional()
    .describe(
      'Service template (postgresql, mysql, redis, mongodb, rabbitmq, minio). Provides auto-credentials, healthcheck, and default config. Can be combined with image to override the default Docker image while keeping template benefits.',
    ),
  image: z
    .string()
    .optional()
    .describe(
      'Docker image (e.g., pgvector/pgvector:pg17). When used with template, overrides the template default image. When used alone, port is required.',
    ),
  port: z
    .number()
    .int()
    .positive()
    .max(65535)
    .optional()
    .describe('Port number (required when using image without template)'),
  project_id: z.string().optional().describe('Attach the new resource to this Project id.'),
  project_name: z
    .string()
    .optional()
    .describe('Attach the new resource to this Project name. Prefer project_id when known.'),
  target_project_id: z
    .string()
    .optional()
    .describe('Legacy alias for project_id. Attach the new resource to an existing Project.'),
});

export const serviceNameSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
});

export const removeServiceSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
  force: z
    .boolean()
    .optional()
    .describe('Force removal even if projects reference this service. Default: false.'),
});

export const backupServiceSchema = z.object({
  service_name: z.string().min(1),
});

export const restoreServiceSchema = z.object({
  service_name: z.string().min(1),
  backup_id: z.string().min(1),
});

export const listServiceBackupsSchema = z.object({
  service_name: z.string().min(1),
});

export const getServiceLogsSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
  lines: z.number().int().positive().optional().describe('Number of log lines to retrieve'),
});

export const listDatabasesSchema = z.object({
  service_name: z.string().min(1).describe('Service name to inspect'),
});

export const createDatabaseSchema = z.object({
  service_name: z.string().min(1).describe('Service name where database will be created'),
  database_name: z.string().min(1).describe('Database name to create'),
});

export const createServiceUserSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
  username: z.string().min(1).describe('Username'),
  password: z.string().optional().describe('Password (auto-generated if omitted)'),
  database: z.string().optional().describe('Database name'),
});

export const execServiceContainerSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
  command: z
    .array(z.string())
    .min(1)
    .describe(
      'Command to execute as an array (e.g., ["psql", "-U", "openlander", "-c", "CREATE EXTENSION vector"])',
    ),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(600)
    .optional()
    .describe(
      'Max execution time in seconds (default: 60, max: 600). Command may continue running after timeout.',
    ),
});

export const listServicesSchema = z
  .object({
    project_id: z
      .string()
      .min(1)
      .optional()
      .describe('Only list Database/Cache/Storage resources attached to this Project id.'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe('Only list Database/Cache/Storage resources attached to this Project name.'),
    include_orphans: z
      .boolean()
      .optional()
      .describe(
        'Include OpenLander infrastructure resource containers missing from the resource inventory.',
      ),
  })
  .strict();

export const listDataSourcesSchema = z
  .object({
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
    environment_key: z
      .enum(ENVIRONMENT_KEYS)
      .optional()
      .describe('Reserved for environment-scoped data sources. v1 lists Project-level sources.'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

export const describeDataSourceSchema = z.object({
  service_id: z.string().min(1).describe('Managed Postgres/Redis service_id'),
  database: z
    .union([z.string().min(1), z.number().int().min(0).max(15)])
    .optional()
    .describe('Postgres database name or Redis DB index (0-15) to inspect'),
  schema: z.string().min(1).optional().describe('Postgres schema to inspect (default: public)'),
});

export const readDataSourceSchema = z.object({
  service_id: z.string().min(1).describe('Managed Postgres/Redis service_id'),
  operation: z
    .enum([
      'sql.query',
      'redis.get',
      'redis.mget',
      'redis.type',
      'redis.ttl',
      'redis.hgetall',
      'redis.scan',
    ])
    .describe('Read-only data operation. Write operations are intentionally not expressible.'),
  query: z.string().optional().describe('Postgres SELECT or read-only WITH query'),
  database: z
    .union([z.string().min(1), z.number().int().min(0).max(15)])
    .optional()
    .describe('Postgres database name or Redis DB index (0-15)'),
  key: z.string().min(1).optional().describe('Redis key for get/type/ttl/hgetall'),
  keys: z.array(z.string().min(1)).optional().describe('Redis keys for mget'),
  pattern: z.string().optional().describe('Redis SCAN pattern'),
  limit: z.number().int().positive().max(100).optional().describe('Row/item cap, max 100'),
});

export const platformAdoptOrphanServiceSchema = z.object({
  container_id: z.string().optional().describe('Docker container id to adopt'),
  container_name: z.string().optional().describe('Docker container name to adopt'),
  service_name: z
    .string()
    .optional()
    .describe('Service name to register (defaults from label/name)'),
  service_type: z
    .string()
    .optional()
    .describe('Service type/kind to register. Defaults to image for custom images.'),
  confirm: z.boolean().optional().describe('Must be true to create the DB service row.'),
});

// Infrastructure & analysis schemas
export const analyzeInfrastructureSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch'),
  git_credential_id: z.string().min(1).optional().describe('Repository Deploy Key credential ID'),
});

// Debug & troubleshooting schemas
export const getBuildLogSchema = z
  .object({
    deploy_id: z
      .string()
      .min(1)
      .optional()
      .describe('Deploy log id. If provided, no project target is required.'),
    service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
    service_name: z.string().min(1).optional().describe('Application/Compose name'),
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
    deploy_index: z
      .number()
      .int()
      .optional()
      .describe('Deploy index (0 = latest, 1 = previous). Default: 0'),
    tail: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Return only the last N lines of the build/runtime logs. Useful for large logs.'),
  })
  .refine(
    (value) =>
      Boolean(
        value.deploy_id ||
        value.service_id ||
        value.service_name ||
        value.project_id ||
        value.project_name,
      ),
    {
      message: 'deploy_id, service_id, service_name, project_id, or project_name is required',
    },
  );

export const debugBuildErrorSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  build_log: z
    .string()
    .optional()
    .describe('Optional build log text to analyze when stored deploy logs are missing'),
});

// Empty schema for tools with no parameters
export const emptySchema = z.object({}).strict();

// Scan project schema
export const scanProjectSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch'),
  git_credential_id: z.string().min(1).optional().describe('Repository Deploy Key credential ID'),
  clone_path: z
    .string()
    .optional()
    .describe('Existing clone path to reuse instead of cloning again'),
});

// Expose/unexpose public schemas
export const exposePublicSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const unexposePublicSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// List previews schema
export const listPreviewsSchema = z.object({}).strict();

// Cleanup preview schema
export const cleanupPreviewSchema = z.object({
  preview_id: z.string().min(1).describe('Preview deployment ID'),
});

// Get system stats schema
export const getSystemStatsSchema = z.object({}).strict();

export const diagnoseHostResourcesSchema = z
  .object({
    container_limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum number of top resource-consuming containers to return'),
    include_disk_usage: z
      .boolean()
      .optional()
      .describe('Whether to include Docker system df totals. Defaults to true.'),
  })
  .strict();

// Get alerts schema
export const getAlertsSchema = z.object({}).strict();

// Dismiss alert schema
export const dismissAlertSchema = z.object({
  alert_id: z.string().min(1).describe('Alert ID'),
});

// List global secrets schema
export const listGlobalSecretsSchema = z.object({}).strict();

const domainRouteTargetFields = {
  service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
  service_name: z.string().min(1).optional().describe('Application/Compose name'),
  project_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project id. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project name. If service_id/service_name is omitted, the Project must contain exactly one Application/Compose workload.',
    ),
} as const;

export const addDomainRouteSchema = z
  .object({
    ...domainRouteTargetFields,
    domain: z
      .string()
      .min(1)
      .describe('Domain host that already points to the OpenLander host/reverse proxy'),
    path_prefix: z
      .string()
      .optional()
      .describe('Public path prefix to match (default: /, e.g. /api)'),
    strip_prefix: z
      .boolean()
      .optional()
      .describe('If true, strip path_prefix before forwarding to the service'),
    upstream_path_prefix: z
      .string()
      .optional()
      .describe('Internal path prefix to add before forwarding to the service (default: /)'),
    target_port: z
      .number()
      .int()
      .min(1)
      .max(65535)
      .optional()
      .describe('Override service container port for this route'),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.service_id || value.service_name || value.project_id || value.project_name),
    {
      message: 'service_id, service_name, project_id, or project_name is required',
    },
  );

export const listDomainRoutesSchema = z
  .object({
    ...domainRouteTargetFields,
    verify: z
      .boolean()
      .optional()
      .describe(
        'Probe registered routes through the managed Traefik HTTP provider. Defaults to true for targeted lookups and false for unfiltered lists.',
      ),
  })
  .strict();

// Agent-specific schemas
export const agentExecuteGoalSchema = z.object({
  goal: z.string().min(1).describe('The goal for the agent to accomplish using available tools'),
});

// Ask user question schema
export const askUserQuestionSchema = z.object({
  question: z.string().min(1).describe('Question to ask the user'),
  options: z.array(z.string()).optional().describe('Multiple choice options'),
});

// Fix dockerfile schema
export const fixDockerfileSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  error: z.string().min(1).describe('Build error message'),
});

export const uploadSecretFileSchema = z.object({
  project_name: z
    .string()
    .optional()
    .describe('Project name. Omit for global secret file (shared across all projects).'),
  filename: z.string().min(1).describe('Filename (e.g. firebase-sa.json, tls-cert.pem)'),
  content: z.string().min(1).describe('File content (plaintext — will be encrypted at rest)'),
  mount_path: z
    .string()
    .optional()
    .describe(
      'Container mount directory (default: /run/secrets). File available at mount_path/filename.',
    ),
});

export const listSecretFilesSchema = z.object({
  project_name: z.string().optional().describe('Project name. Omit to list global secret files.'),
});

export const removeSecretFileSchema = z.object({
  project_name: z.string().optional().describe('Project name. Omit for global secret file.'),
  filename: z.string().min(1).describe('Filename to remove'),
});

// Deploy Plan Engine schemas
export const createDeployPlanSchema = z
  .object({
    repo_url: z
      .string()
      .min(1)
      .optional()
      .describe('Git repository URL (e.g., github.com/user/repo)'),
    branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
    git_credential_id: z
      .string()
      .min(1)
      .optional()
      .describe('Verified repository Deploy Key credential ID. Omit for automatic selection.'),
    name: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        'Project name must start with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens',
      )
      .optional()
      .describe('Project name (auto-generated from repo if not provided)'),
    source: z.enum(['git', 'image']).optional().describe('Deployment source type'),
    image: z.string().optional().describe('Docker image to deploy (e.g., nginx:latest)'),
    cmd: z.array(z.string()).optional().describe('Container command override'),
    port: z.number().int().positive().max(65535).optional().describe('Container port'),
    health_check_path: z
      .string()
      .optional()
      .describe('Health check path for the deployed service.'),
    env_vars: envVarsInputSchema
      .optional()
      .describe(
        'Environment variables as an object or JSON-stringified object (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})',
      ),
    prefer_dockerfile: z
      .boolean()
      .optional()
      .describe('Prefer Dockerfile flow and skip compose detection'),
    dockerfile_path: z
      .string()
      .optional()
      .describe('Relative Dockerfile path inside the repository (e.g., frontend/Dockerfile)'),
    build_context: z
      .string()
      .min(1)
      .optional()
      .describe('Docker build context relative to repository root (e.g., . or services/api)'),
    docker_target: z
      .string()
      .optional()
      .describe('Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)'),
    compose_file: z
      .string()
      .min(1)
      .optional()
      .describe('Repository-relative production Compose file path.'),
    compose_files: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Ordered repository-relative Compose files, from base to overlays.'),
    compose_profiles: z
      .array(z.string().min(1))
      .optional()
      .describe('Compose profiles to activate.'),
    traffic_service: z
      .string()
      .min(1)
      .optional()
      .describe('Compose application service that represents public traffic.'),
    environment: z
      .enum(['production', 'development'])
      .optional()
      .describe('Deployment environment. Defaults to production.'),
    target_project_id: z
      .string()
      .optional()
      .describe(
        'Create the plan for deploying one Application, worker, or Compose workload into an existing Project. A plan selects one Dockerfile Application; repeat with the same target_project_id for siblings. Proposed safe Database/Cache resources use the deploy-plan approval path for same-project provisioning.',
      ),
  })
  .superRefine((data, ctx) => {
    if (data.compose_file && data.compose_files) {
      ctx.addIssue({
        code: 'custom',
        path: ['compose_files'],
        message: 'compose_file and compose_files cannot be combined.',
      });
    }
    if (data.image && data.source !== 'image') {
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message:
          'image was provided, so source must be set to "image". For Git deploys, omit image and pass repo_url.',
      });
      return;
    }

    if (data.source === 'image') {
      if (data.build_context) {
        ctx.addIssue({
          code: 'custom',
          path: ['build_context'],
          message: 'build_context is only valid for Git Dockerfile deployments.',
        });
      }
      if (
        data.compose_file ||
        data.compose_files ||
        data.compose_profiles ||
        data.traffic_service
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['compose_file'],
          message: 'Compose settings are only valid for Git repository deploys.',
        });
      }
      if (data.git_credential_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['git_credential_id'],
          message: 'git_credential_id is only valid for Git repository deploys.',
        });
      }
      if (!data.image || data.image.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message: 'image is required when source is "image".',
        });
      }
      return;
    }

    if (!data.repo_url || data.repo_url.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['repo_url'],
        message: 'repo_url is required for Git deploys. For image deploys, set source to "image".',
      });
    }
  });

export const updateDeployPlanSchema = z.object({
  plan_id: z.string().min(1).describe('Plan ID returned from create_deploy_plan'),
  updates: z
    .string()
    .min(1)
    .describe(
      'JSON object with plan updates. Supported fields include env, build, compose_file, compose_files, compose_profiles, traffic_service, services, and health. compose_files is ordered base-to-overlay and cannot be combined with compose_file. For user-supplied external env, use env:{provided:{KEY:"..."},trusted:["KEY"]}.',
    ),
});

export const executeDeployPlanSchema = z.object({
  plan_id: z
    .string()
    .min(1)
    .describe(
      'Plan ID to execute. Plan must be in "ready" status, or "needs_approval" when called with approve_all_safe_resources / approvals.create_resources.',
    ),
  deploy_only: z
    .array(z.string())
    .optional()
    .describe(
      'For Compose projects: replace only these service names (e.g., ["backend", "worker"]). Dependencies remain prerequisites and are not implicitly replaced. Omit to use the full deployment plan.',
    ),
  approve_all_safe_resources: z
    .boolean()
    .optional()
    .describe(
      'For "needs_approval" plans: approve auto-provisioning of ALL proposed safe managed resources (e.g. postgresql, redis). Equivalent to listing every proposed resource in approvals.create_resources.',
    ),
  approvals: z
    .object({
      create_resources: z
        .array(z.string())
        .optional()
        .describe(
          'Identifiers of proposed safe managed resources to approve, matched by service type (e.g. ["postgresql", "redis"]).',
        ),
    })
    .optional()
    .describe('Explicit per-resource approvals for "needs_approval" plans.'),
});

export const getDeployPlanSchema = z.object({
  plan_id: z.string().min(1).describe('Plan ID returned from create_deploy_plan'),
});

export const cancelDeploySchema = z
  .object({
    deploy_id: z.string().min(1).optional().describe('Deploy log ID returned by deploy APIs'),
    service_id: z
      .string()
      .min(1)
      .optional()
      .describe('Application/Compose service_id whose active build should stop'),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe('Application/Compose name whose active build should stop'),
    project_id: z.string().min(1).optional().describe('Project ID whose active build should stop'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe('Project name whose active build should stop'),
    id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Alias for deploy_id, project_id, or project_name when the caller has one id field',
      ),
  })
  .refine(
    (data) =>
      Boolean(
        data.deploy_id ??
        data.service_id ??
        data.service_name ??
        data.project_id ??
        data.project_name ??
        data.id,
      ),
    {
      message:
        'One of deploy_id, service_id, service_name, project_id, project_name, or id is required',
    },
  );

// One-call deploy schema (create plan + execute + optionally wait)
export const deploySchema = z
  .object({
    service_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing Application/Compose service_id. When provided, deploy_app acts as a redeploy front door.',
      ),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing Application/Compose name. Project name is accepted only when that Project has exactly one workload.',
      ),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing Project name for redeploy lookup or service_name scoping. For new app names, use name.',
      ),
    repo_url: z
      .string()
      .min(1)
      .optional()
      .describe('Git repository URL (e.g., github.com/user/repo)'),
    branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
    git_credential_id: z
      .string()
      .min(1)
      .optional()
      .describe('Verified repository Deploy Key credential ID. Omit for automatic selection.'),
    name: z.string().optional().describe('Project name (auto-generated from repo if not provided)'),
    source: z.enum(['git', 'image']).optional().describe('Deployment source type'),
    image: z.string().optional().describe('Docker image to deploy (e.g., nginx:latest)'),
    cmd: z.array(z.string()).optional().describe('Container command override'),
    port: z.number().int().positive().max(65535).optional().describe('Container port'),
    no_cache: z
      .boolean()
      .optional()
      .describe(
        'When deploy_app resolves an existing service, force a fresh Docker build. Use when Docker cache may have hidden a dependency change.',
      ),
    strategy: z
      .enum(['blue-green', 'force'])
      .optional()
      .describe(
        'When deploy_app resolves an existing service, redeploy strategy. Omit for the safe default: blue-green when eligible, otherwise block. Use force only when the user explicitly accepts downtime.',
      ),
    health_check_path: z
      .string()
      .optional()
      .describe('Health check path for the deployed or redeployed service.'),
    env_vars: envVarsInputSchema
      .optional()
      .describe(
        'Environment variables as an object or JSON-stringified object (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})',
      ),
    prefer_dockerfile: z
      .boolean()
      .optional()
      .describe('Prefer Dockerfile flow and skip compose detection'),
    dockerfile_path: z
      .string()
      .optional()
      .describe('Relative Dockerfile path inside the repository (e.g., frontend/Dockerfile)'),
    build_context: z
      .string()
      .min(1)
      .optional()
      .describe('Docker build context relative to repository root (e.g., . or services/api)'),
    docker_target: z
      .string()
      .optional()
      .describe('Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)'),
    traffic_service: z
      .string()
      .min(1)
      .optional()
      .describe('Compose application service that represents public traffic.'),
    wait: z
      .boolean()
      .optional()
      .describe(
        'Block until deployment completes or fails (default: true). Set false to return immediately after build starts.',
      ),
    wait_healthy: z
      .boolean()
      .optional()
      .describe(
        'When wait=true, also wait up to 30s for Docker HEALTHCHECK to become healthy (default: true). Set false to return an immediate readiness snapshot.',
      ),
    timeout: z
      .number()
      .optional()
      .describe('Max seconds to wait for completion when wait=true (default: 300)'),
    expose: z
      .boolean()
      .optional()
      .describe(
        'After deploy succeeds, create a temporary tunnel URL using the configured tunnel backend (default: false). Requires wait=true.',
      ),
    target_project_id: z
      .string()
      .optional()
      .describe(
        'Attach a newly deployed Application, worker, or Compose workload to an existing Project after the deploy succeeds. The attach is owned by durable deploy-plan execution; failed deploys remain separate attempts. Multiple Dockerfiles require one dockerfile_path per plan. Not supported with expose=true.',
      ),
  })
  .superRefine((data, ctx) => {
    if (data.service_id || data.service_name) {
      return;
    }
    if ((data.name || data.project_name) && !data.repo_url && !data.image) {
      return;
    }

    if (data.image && data.source !== 'image') {
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message:
          'image was provided, so source must be set to "image". For Git deploys, omit image and pass repo_url.',
      });
      return;
    }

    if (data.source === 'image') {
      if (data.build_context) {
        ctx.addIssue({
          code: 'custom',
          path: ['build_context'],
          message: 'build_context is only valid for Git Dockerfile deployments.',
        });
      }
      if (data.git_credential_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['git_credential_id'],
          message: 'git_credential_id is only valid for Git repository deploys.',
        });
      }
      if (!data.image || data.image.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['image'],
          message: 'image is required when source is "image".',
        });
      }
      return;
    }

    if (!data.repo_url || data.repo_url.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['repo_url'],
        message: 'repo_url is required for Git deploys. For image deploys, set source to "image".',
      });
    }
  })
  .superRefine((data, ctx) => {
    if ((data.repo_url || data.image) && data.project_name && !data.name) {
      ctx.addIssue({
        code: 'custom',
        path: ['project_name'],
        message:
          'project_name scopes existing app lookups only. For new app deploys, use name as the Project name.',
      });
    }
  });

export const validateDeployPlanSchema = z.object({
  plan_id: z.string().min(1).describe('Plan ID returned from create_deploy_plan'),
});

export const updateProjectConfigSchema = z
  .object({
    project_name: z.string().min(1).describe('Project name'),
    dockerfile_path: z
      .string()
      .optional()
      .describe(
        'Relative Dockerfile path inside the repository (e.g., apps/api/Dockerfile). Set to "Dockerfile" to reset to default.',
      ),
    docker_target: z
      .string()
      .optional()
      .describe(
        'Docker build target stage for multi-stage Dockerfiles (e.g., api, worker). Set to empty string to clear.',
      ),
    build_context: z
      .string()
      .optional()
      .describe(
        'Docker build context path relative to repo root (e.g., apps/api). Set to empty string to clear.',
      ),
  })
  .refine(
    (data) =>
      data.dockerfile_path !== undefined ||
      data.docker_target !== undefined ||
      data.build_context !== undefined,
    {
      message: 'At least one of dockerfile_path, docker_target, or build_context must be provided',
    },
  );

// Deployment history schema
export const deployHistorySchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
    service_name: z.string().min(1).optional().describe('Application/Compose name'),
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
    limit: z.number().optional().describe('Max entries to return (default 10)'),
  })
  .refine(
    (value) =>
      Boolean(value.service_id || value.service_name || value.project_id || value.project_name),
    {
      message: 'service_id, service_name, project_id, or project_name is required',
    },
  );

export const addVolumeSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  volume_name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Must be lowercase alphanumeric with hyphens, starting with a letter or digit',
    )
    .describe('Volume name (lowercase alphanumeric and hyphens)'),
  mount_path: z
    .string()
    .min(1)
    .startsWith('/', 'Must be an absolute path (e.g., /app/uploads)')
    .describe('Absolute mount path inside the container (e.g., /app/uploads)'),
});

export const listVolumesSchema = z.object({
  project_name: z.string().optional().describe('Project name to filter Storage volumes'),
});

export const removeVolumeSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  volume_name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Must be lowercase alphanumeric with hyphens, starting with a letter or digit',
    )
    .describe('Volume name (lowercase alphanumeric and hyphens)'),
});

export const listBucketsSchema = z.object({
  service_name: z.string().min(1).describe('MinIO service name'),
});

export const createBucketSchema = z.object({
  service_name: z.string().min(1).describe('MinIO service name'),
  bucket_name: z
    .string()
    .min(3)
    .max(63)
    .regex(
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/,
      'Must follow S3 bucket naming rules (lowercase, 3-63 chars)',
    )
    .describe('Bucket name (lowercase, 3-63 characters, S3 naming rules)'),
});

export const deleteBucketSchema = z.object({
  service_name: z.string().min(1).describe('MinIO service name'),
  bucket_name: z.string().min(1).describe('Bucket name to delete'),
});

export const getDiskUsageSchema = z.object({});

export const cleanupDockerSchema = z.object({
  level: z
    .enum(['soft', 'standard', 'aggressive'])
    .optional()
    .default('standard')
    .describe(
      'Cleanup intensity. soft: dangling (untagged) images only — fast, minimal impact. standard: dangling images + all build cache — frees more space but next build will be slower. aggressive: standard + all unused images older than 24h — frees the most space but may remove rollback images and cached base images.',
    ),
});

export const probeHostSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .optional()
      .describe('Hostname, IP, URL, or "container-name:port" to probe'),
    host: z.string().min(1).optional().describe('Alias for target'),
    port: z
      .number()
      .int()
      .positive()
      .max(65535)
      .optional()
      .describe('Port to probe (required for TCP mode, optional for HTTP)'),
    protocol: z
      .enum(['http', 'https', 'tcp'])
      .optional()
      .describe('Protocol to use (default: auto-detect from target)'),
    path: z.string().optional().describe('HTTP path to probe (default: "/")'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Timeout in milliseconds (default: 5000)'),
    internal: z
      .boolean()
      .optional()
      .describe(
        'If true, probe from inside the target Application/Compose container. Provide service_id/service_name/project_id/project_name for isolated Docker DNS probes. Default: false.',
      ),
    service_id: z
      .string()
      .min(1)
      .optional()
      .describe('Application/Compose service_id for internal probe context'),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe('Application/Compose name for internal probe context'),
    project_id: z.string().min(1).optional().describe('Project id for internal probe context'),
    project_name: z.string().min(1).optional().describe('Project name for internal probe context'),
  })
  .refine((value) => Boolean(value.target || value.host), {
    message: 'target or host is required',
  });
