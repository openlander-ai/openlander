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
});

export const projectNameSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
});

export const getLogsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  lines: z.number().int().positive().optional().describe('Number of log lines to retrieve'),
});

// Environment & configuration schemas
export const setEnvVarsSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  variables: z
    .string()
    .min(1)
    .describe('JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})'),
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

// Database & service schemas
export const provisionDbSchema = z.object({
  project_name: z.string().min(1).describe('Project name'),
  db_type: z
    .string()
    .optional()
    .describe('Database type: "sqlite" or "postgres" (default: postgres)'),
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
