import { z } from 'zod';

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
  env_vars: z
    .string()
    .optional()
    .describe(
      'JSON object of environment variables to set before deploy (e.g., {"DATABASE_URL": "...", "REDIS_URL": "..."})',
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

export const getLogsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  lines: z.number().int().positive().optional().describe('Number of log lines to retrieve'),
});

export const getProjectStatsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
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

// Environment & configuration schemas
export const setEnvVarsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  variables: z
    .string()
    .min(1)
    .describe('JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})'),
});

export const listEnvVarsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  environment_name: z
    .string()
    .optional()
    .describe(
      'Environment name to show source tracking (global/project/production/environment). Omit for backward-compatible response.',
    ),
});

export const getEnvVarSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  key: z.string().min(1).describe('Environment variable key to retrieve'),
});

export const setGlobalSecretSchema = z.object({
  key: z.string().min(1).describe('Secret key'),
  value: z.string().min(1).describe('Secret value'),
  description: z.string().optional().describe('Description of the secret'),
});

// Domain & networking schemas
export const domainSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  domain: z.string().min(1).describe('Domain name'),
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
  project_name: z.string().optional().describe('Project name (optional, returns all if omitted)'),
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

export const deployMonorepoSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  clone_path: z.string().min(1).describe('Path where repo is cloned'),
  commit_sha: z.string().min(1).describe('Commit SHA'),
  dockerfiles: z
    .union([z.array(z.string()), z.string().min(1)])
    .describe(
      'Dockerfile paths from scan_dockerfiles — array or JSON string, e.g. ["frontend/Dockerfile", "backend/Dockerfile"]',
    ),
  branch: z.string().optional().describe('Branch'),
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
  template: z.string().optional().describe('Service template (postgres, mysql, redis, etc.)'),
  image: z.string().optional().describe('Docker image'),
  port: z.number().int().positive().optional().describe('Port number'),
});

export const serviceNameSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
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

export const createServiceDatabaseSchema = z.object({
  service_name: z.string().min(1).describe('Service name'),
  database_name: z.string().min(1).describe('Database name'),
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

export const listServicesSchema = z.object({}).strict();

// Infrastructure & analysis schemas
export const analyzeInfrastructureSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL'),
  branch: z.string().optional().describe('Branch'),
});

export const webSearchSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  max_results: z.number().int().positive().optional().describe('Maximum results'),
});

// Debug & troubleshooting schemas
export const getBuildLogSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  deploy_index: z
    .number()
    .int()
    .optional()
    .describe('Deploy index (0 = latest, 1 = previous). Default: 0'),
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

// Redeploy schema
export const redeployProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  no_cache: z
    .boolean()
    .optional()
    .describe(
      'Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.',
    ),
});

// Rollback schema
export const rollbackProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Blue-green deploy schema
export const deployBlueGreenSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Restart project schema
export const restartProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  no_cache: z
    .boolean()
    .optional()
    .describe(
      'Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.',
    ),
});

// Stop project schema
export const stopProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Remove project schema
export const removeProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Expose/unexpose public schemas
export const exposePublicSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const unexposePublicSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const startProjectSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  environment: z
    .string()
    .optional()
    .describe('Environment to start (e.g. "production", "development"). Omit for default.'),
});

export const shareProjectSchema = z.object({
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

// Webhook management schemas
export const enableWebhookSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  source: z.enum(['github', 'gitlab', 'bitbucket']).describe('Git provider'),
  branch_filter: z.string().optional().describe('Branch to trigger deploys on (default: main)'),
});

export const disableWebhookSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  source: z.enum(['github', 'gitlab', 'bitbucket']).describe('Git provider'),
});

export const getWebhookConfigSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

// Environment management schemas
export const createEnvironmentSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  type: z.enum(['production', 'development']).describe('Environment type'),
  branch: z.string().min(1).describe('Git branch for this environment'),
});

export const listEnvironmentsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const deployEnvironmentSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  environment_type: z.enum(['production', 'development']).describe('Environment to deploy'),
  no_cache: z
    .boolean()
    .optional()
    .describe(
      'Force fresh Docker build without cache. Use when dependencies changed but Docker layers are stale.',
    ),
});

// Deploy Plan Engine schemas
export const createDeployPlanSchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL (e.g., github.com/user/repo)'),
  branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
  name: z.string().optional().describe('Project name (auto-generated from repo if not provided)'),
  env_vars: z
    .string()
    .optional()
    .describe(
      'JSON object of environment variables to include in the plan (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})',
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
export const deploySchema = z.object({
  repo_url: z.string().min(1).describe('Git repository URL (e.g., github.com/user/repo)'),
  branch: z.string().optional().describe('Branch to deploy (default: repo default branch)'),
  name: z.string().optional().describe('Project name (auto-generated from repo if not provided)'),
  env_vars: z
    .string()
    .optional()
    .describe(
      'JSON object of environment variables (e.g., {"DATABASE_URL": "...", "API_KEY": "..."})',
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
  timeout: z
    .number()
    .optional()
    .describe('Max seconds to wait for completion when wait=true (default: 300)'),
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
export const deployHistorySchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  environment_name: z
    .string()
    .optional()
    .describe('Filter by environment (e.g. "production", "development")'),
  limit: z.number().optional().describe('Max entries to return (default 10)'),
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
