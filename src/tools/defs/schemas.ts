import { z } from 'zod';

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

const monitoringTargetFields = {
  service_id: z.string().min(1).optional().describe('Deployable service id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Deployable service row name. If no service has that name, a project group name with exactly one deployable service is accepted.',
    ),
  project_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project group id. If service_id/service_name is omitted, the group must contain exactly one deployable service.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project group name. If service_id/service_name is omitted, the group must contain exactly one deployable service.',
    ),
} as const;

function monitoringTargetSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...monitoringTargetFields, ...shape })
    .refine(
      (value: {
        service_id?: unknown;
        service_name?: unknown;
        project_id?: unknown;
        project_name?: unknown;
      }) =>
        Boolean(value.service_id || value.service_name || value.project_id || value.project_name),
      {
        message: 'service_id, service_name, project_id, or project_name is required',
      },
    );
}

export const getLogsSchema = monitoringTargetSchema({
  lines: z.number().int().positive().optional().describe('Number of log lines to retrieve'),
});

export const getProjectStatsSchema = monitoringTargetSchema({});

export const getInstanceInfoSchema = z.object({}).strict();

export const diagnoseServiceSchema = z
  .object({
    service_id: z.string().min(1).optional().describe('Deployable service id'),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Deployable service row name. If no service has that name, a project group name with exactly one deployable service is accepted.',
      ),
    project_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Project group id. If service_id/service_name is omitted, the group must contain exactly one deployable service.',
      ),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Project group name. If service_id/service_name is omitted, the group must contain exactly one deployable service.',
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
    service_id: z.string().min(1).optional().describe('Managed/infrastructure service id'),
    service_name: z.string().min(1).optional().describe('Managed/infrastructure service name'),
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
  confirm: z.boolean(),
  dry_run: z.boolean().optional().default(true),
});

export const platformReconcileSchema = z.object({
  confirm: z.boolean(),
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
  service_id: z.string().min(1).optional().describe('Deployable service id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Deployable service row name. If no service has that name, a project group name with exactly one deployable service is accepted.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Project group name. If service_id/service_name is omitted, the group must contain exactly one deployable service.',
    ),
} as const;

function envTargetSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...envTargetFields, ...shape })
    .refine(
      (value: { service_id?: unknown; service_name?: unknown; project_name?: unknown }) =>
        Boolean(value.service_id || value.service_name || value.project_name),
      {
        message: 'service_id, service_name, or project_name is required',
      },
    );
}

// Environment & configuration schemas
export const setEnvVarsSchema = envTargetSchema({
  variables: envVarsInputSchema.describe(
    'Environment variables as an object or JSON-stringified object (e.g., {"DATABASE_URL": "..."})',
  ),
  defer_redeploy: z
    .boolean()
    .optional()
    .describe('Default true. If true, save only and require an explicit redeploy to apply.'),
});

export const listEnvVarsSchema = envTargetSchema({
  reveal: z.boolean().optional().describe('If true, return unmasked raw values. Default: false.'),
});

export const getEnvVarSchema = envTargetSchema({
  key: z.string().min(1).describe('Environment variable key to retrieve'),
});

export const exportEnvVarsSchema = envTargetSchema({});

export const deleteEnvVarSchema = envTargetSchema({
  key: z.string().min(1).describe('Environment variable key to delete'),
  defer_redeploy: z
    .boolean()
    .optional()
    .describe('Default true. If true, delete only and require an explicit redeploy to apply.'),
});

export const bulkDeleteEnvVarsSchema = envTargetSchema({
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
    service_id: z.string().min(1).optional().describe('Deployable service id'),
    service_name: z.string().min(1).optional().describe('Deployable service name'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional project group name. Legacy fallback: if service_id/service_name is omitted, the group must contain exactly one deployable service.',
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
});

export const previewIdSchema = z.object({
  preview_id: z.string().min(1).describe('Preview deployment ID'),
});

// Status & monitoring schemas
export const deployStatusSchema = z.object({
  project_id: z
    .string()
    .optional()
    .describe('Project group id for current in-flight status lookup'),
  project_name: z
    .string()
    .optional()
    .describe('Project group name for current in-flight status lookup'),
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
});

// Git & repository schemas
export const scanDockerfilesSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch to scan'),
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
  project_id: z.string().optional().describe('Attach the new service to this project group id.'),
  project_name: z
    .string()
    .optional()
    .describe('Attach the new service to this project group name. Prefer project_id when known.'),
  target_project_id: z
    .string()
    .optional()
    .describe('Legacy alias for project_id. Attach the new service to an existing project group.'),
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
    include_orphans: z
      .boolean()
      .optional()
      .describe('Include OpenLander-managed service containers missing from the services table.'),
  })
  .strict();

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
});

// Debug & troubleshooting schemas
export const getBuildLogSchema = z
  .object({
    deploy_id: z
      .string()
      .min(1)
      .optional()
      .describe('Deploy log id. If provided, no project target is required.'),
    project_id: z.string().min(1).optional().describe('Project group id'),
    project_name: z.string().min(1).optional().describe('Project group name'),
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
      .describe('Return only the last N lines of the build log. Useful for large logs.'),
  })
  .refine((value) => Boolean(value.deploy_id || value.project_id || value.project_name), {
    message: 'deploy_id, project_id, or project_name is required',
  });

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

// Map domain schema (alias for domainSchema)
export const mapDomainSchema = domainSchema;

// List domains schema
export const listDomainsSchema = z.object({}).strict();

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
    docker_target: z
      .string()
      .optional()
      .describe('Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)'),
  })
  .superRefine((data, ctx) => {
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
      'JSON object with plan updates. Supported fields: env (to fill missing environment variables), dockerfile (to select specific Dockerfile), services (to configure service decisions)',
    ),
});

export const executeDeployPlanSchema = z.object({
  plan_id: z.string().min(1).describe('Plan ID to execute. Plan must be in "ready" status.'),
  deploy_only: z
    .array(z.string())
    .optional()
    .describe(
      'For compose projects: deploy only these service names (e.g., ["backend", "worker"]). Omit to deploy all services.',
    ),
});

// One-call deploy schema (create plan + execute + optionally wait)
export const deploySchema = z
  .object({
    service_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing deployable service id. When provided, deploy_app acts as a redeploy front door.',
      ),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing deployable service row name. Project group name is accepted only when that group has exactly one deployable service.',
      ),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Existing project group name for redeploy lookup or service_name scoping. For new app names, use name.',
      ),
    repo_url: z
      .string()
      .min(1)
      .optional()
      .describe('Git repository URL (e.g., github.com/user/repo)'),
    branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
    name: z.string().optional().describe('Project name (auto-generated from repo if not provided)'),
    source: z.enum(['git', 'image']).optional().describe('Deployment source type'),
    image: z.string().optional().describe('Docker image to deploy (e.g., nginx:latest)'),
    cmd: z.array(z.string()).optional().describe('Container command override'),
    port: z.number().int().positive().max(65535).optional().describe('Container port'),
    no_cache: z
      .boolean()
      .optional()
      .describe('When deploy_app resolves an existing service, force a fresh Docker build.'),
    strategy: z
      .enum(['blue-green', 'force'])
      .optional()
      .describe('When deploy_app resolves an existing service, redeploy strategy.'),
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
    docker_target: z
      .string()
      .optional()
      .describe('Docker build target stage for multi-stage Dockerfiles (e.g., api, worker)'),
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
    domain: z
      .string()
      .optional()
      .describe(
        'Map a custom domain after deploy succeeds using the configured domain routing backend. Example: api.myapp.com. Requires wait=true.',
      ),
    target_project_id: z
      .string()
      .optional()
      .describe(
        'Attach the new deployable as an additional service under an existing project group instead of creating a fresh project. The deployable receives a unique service id (the project keeps its existing services). Use this to add a worker/api/web sibling to an existing app group.',
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
          'project_name scopes existing app lookups only. For new app deploys, use name as the project name.',
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
    project_id: z.string().min(1).optional().describe('Project group id'),
    project_name: z.string().min(1).optional().describe('Project group name'),
    limit: z.number().optional().describe('Max entries to return (default 10)'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

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
  project_name: z.string().optional().describe('Project name to filter managed volumes'),
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
        'If true, probe from inside the target project service container. Provide service_id/service_name/project_id/project_name for isolated Docker DNS probes. Default: false.',
      ),
    service_id: z
      .string()
      .min(1)
      .optional()
      .describe('Deployable service id for internal probe context'),
    service_name: z
      .string()
      .min(1)
      .optional()
      .describe('Deployable service row name for internal probe context'),
    project_id: z
      .string()
      .min(1)
      .optional()
      .describe('Project group id for internal probe context'),
    project_name: z
      .string()
      .min(1)
      .optional()
      .describe('Project group name for internal probe context'),
  })
  .refine((value) => Boolean(value.target || value.host), {
    message: 'target or host is required',
  });
