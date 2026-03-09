import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { loadConfig } from '../config/index.js';
import { ProjectNotFoundError } from '../errors.js';
import { createGitProvider } from '../git-providers/index.js';
import { getSystemStats, formatStatsSummary } from '../monitor/stats.js';
import { cloneRepo } from '../pipeline/git.js';
import { scanUsedPorts } from '../pipeline/port.js';
import { getProjectUrl } from '../pipeline/traefik.js';
import { DeployOrchestrator, type ServiceNode } from '../pipeline/orchestrator.js';
import type { ToolSpec, ToolTarget } from './types.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('tools');

const deployProjectSchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().optional(),
  name: z.string().optional(),
});

const projectNameSchema = z.object({
  project_name: z.string().min(1),
});

const getLogsSchema = z.object({
  project_name: z.string().min(1),
  lines: z.number().int().positive().optional(),
});

const setEnvVarsSchema = z.object({
  project_name: z.string().min(1),
  variables: z.string().min(1),
});

const setGlobalSecretSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
});

const domainSchema = z.object({
  project_name: z.string().min(1),
  domain: z.string().min(1),
});

const provisionDbSchema = z.object({
  project_name: z.string().min(1),
  db_type: z.string().optional(),
});

const previewDeploySchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().min(1),
});

const previewIdSchema = z.object({
  preview_id: z.string().min(1),
});

const deployStatusSchema = z.object({
  project_name: z.string().optional(),
});

const scanDockerfilesSchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().optional(),
});

const deployMonorepoSchema = z.object({
  repo_url: z.string().min(1),
  clone_path: z.string().min(1),
  commit_sha: z.string().min(1),
  dockerfiles: z.string().min(1),
  branch: z.string().optional(),
});

const orchestrateDeploySchema = z.object({
  repo_url: z.string().min(1),
  branch: z.string().optional(),
});

const listGithubReposSchema = z.object({
  page: z.number().int().positive().optional(),
  visibility: z.enum(['all', 'public', 'private']).optional(),
});

const searchGithubReposSchema = z.object({
  query: z.string().min(1),
});

const emptySchema = z.object({}).strict();

const listAllContainersSchema = z.object({
  state: z.enum(['all', 'running', 'stopped']).optional(),
});

const getContainerStatsSchema = z.object({
  container: z.string().min(1),
});

export interface CreateToolRegistryOptions {
  target?: ToolTarget;
}

export function createToolRegistry(
  ctx: AppContext,
  options: CreateToolRegistryOptions = {},
): ToolSpec[] {
  const target = options.target;
  const tools: ToolSpec[] = [
    {
      name: 'deploy_project',
      description:
        'Start deploying a project from a git repository URL. Returns immediately with { projectId, projectName, status: "building" } while the build runs in the background. ALWAYS follow up with get_deploy_status to check progress and report the result to the user. Errors: CLONE_FAILED (bad URL or private repo without SSH key), BUILD_FAILED (Dockerfile error — suggest debug_build_error next), ALREADY_EXISTS (project name taken). Only works with repos that have a Dockerfile.',
      parameters: {
        repo_url: {
          type: 'string',
          description: 'Git repository URL (e.g., github.com/user/repo)',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch to deploy (default: main)',
          required: false,
        },
        name: {
          type: 'string',
          description: 'Project name (auto-generated from repo if not provided)',
          required: false,
        },
      },
      inputSchema: deployProjectSchema,
      execute: async (args, { target }) => {
        const result = await ctx.pipeline.startDeploy({
          repoUrl: args['repo_url'] as string,
          branch: (args['branch'] as string | undefined) ?? undefined,
          name: (args['name'] as string | undefined) ?? undefined,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          trigger: target === 'agent' ? 'chat' : 'api',
        });
        return { ...result, hint: 'Use get_deploy_status to check progress.' };
      },
    },
    {
      name: 'stop_project',
      description:
        'Stop a running project container gracefully. Use when user wants to pause or shut down a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND — use list_projects to find valid names. Does NOT remove the project; use remove_project for full cleanup.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to stop',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        await ctx.pipeline.stop(project.id);
        return { status: 'stopped', project: projectName };
      },
    },
    {
      name: 'remove_project',
      description:
        'Permanently remove a project — deletes the container, image, and database record. DESTRUCTIVE — cannot be undone. Use only when user explicitly wants to delete a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND. To just stop without deleting, use stop_project instead.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to remove',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        await ctx.pipeline.remove(project.id);
        return { status: 'removed', project: projectName };
      },
    },
    {
      name: 'redeploy_project',
      description: 'Redeploy an existing project.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to redeploy',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        return ctx.pipeline.redeploy(project.id);
      },
      targets: ['mcp'],
    },
    {
      name: 'get_logs',
      description:
        'Get recent container stdout/stderr logs for a project. Use when user asks about errors, crashes, or app behavior. Returns { project, logs } where logs is a string of the most recent 20 lines. Errors: PROJECT_NOT_FOUND. If logs show a build error, suggest debug_build_error for diagnosis.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project',
          required: true,
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to return (default: 20)',
          required: false,
        },
      },
      inputSchema: getLogsSchema,
      execute: async (args, { target }) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        const lines = (args['lines'] as number | undefined) ?? (target === 'agent' ? 20 : 50);
        const logs = await ctx.pipeline.getLogs(project.id, lines);
        return { project: projectName, logs };
      },
    },
    {
      name: 'list_projects',
      description:
        'List all deployed projects with name, status (running/stopped/error), ports, local URLs, and public URLs. Use as the first tool when user asks about their projects, or to verify a project name before other operations. Returns { count, projects[] }. Always available, no errors.',
      parameters: {},
      inputSchema: emptySchema,
      execute: (_args, { target }) => {
        const projects = ctx.db.listProjects();

        if (target === 'mcp') {
          return Promise.resolve({
            count: projects.length,
            projects: projects.map((project) => ({
              id: project.id,
              name: project.name,
              status: project.status,
              visibility: project.visibility,
              repoUrl: project.repo_url,
              branch: project.branch,
              port: project.assigned_port,
              url: project.assigned_port ? getProjectUrl(project.name) : null,
              publicUrl: project.public_url,
              createdAt: project.created_at,
              updatedAt: project.updated_at,
            })),
          });
        }

        return Promise.resolve({
          count: projects.length,
          projects: projects.map((project) => ({
            name: project.name,
            status: project.status,
            visibility: project.visibility,
            port: project.assigned_port,
            url: project.assigned_port ? getProjectUrl(project.name) : null,
            publicUrl: project.public_url,
            repoUrl: project.repo_url,
          })),
        });
      },
    },
    {
      name: 'set_env_vars',
      description:
        'Set environment variables for a project and trigger a redeploy if running. Use when user needs to configure DATABASE_URL, API keys, or other env vars. The variables parameter must be a JSON string of key-value pairs. Returns { status, project, keys[] }. Status is "updated_and_redeployed" if project was running, "updated" otherwise. Errors: PROJECT_NOT_FOUND, JSON parse error if variables is malformed.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project',
          required: true,
        },
        variables: {
          type: 'string',
          description: 'JSON object of key-value pairs (e.g., {"DATABASE_URL": "..."})',
          required: true,
        },
      },
      inputSchema: setEnvVarsSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        const vars = JSON.parse(args['variables'] as string) as Record<string, string>;
        const changed = ctx.env.setBulk(project.id, vars);

        if (changed && project.status === 'running') {
          await ctx.pipeline.redeploy(project.id);
          return {
            status: 'updated_and_redeployed',
            project: projectName,
            keys: Object.keys(vars),
          };
        }

        return {
          status: 'updated',
          project: projectName,
          keys: Object.keys(vars),
        };
      },
    },
    {
      name: 'set_global_secret',
      description:
        'Set a global secret that is available to all projects (stored encrypted). Use for shared API keys, database credentials, etc. that multiple projects need. Returns { status, key }.',
      parameters: {
        key: { type: 'string', description: 'Secret name (e.g. OPENAI_API_KEY)', required: true },
        value: { type: 'string', description: 'Secret value', required: true },
        description: {
          type: 'string',
          description: 'Optional description of what this secret is for',
          required: false,
        },
      },
      inputSchema: setGlobalSecretSchema,
      execute: (args) => {
        const key = args['key'] as string;
        const value = args['value'] as string;
        const description = args['description'] as string | undefined;
        ctx.env.setGlobalSecret(key, value, description);
        return { status: 'saved', key, message: `Global secret "${key}" saved (encrypted).` };
      },
    },
    {
      name: 'list_global_secrets',
      description:
        'List all global secrets (values are masked for security). Returns { secrets: [{ key, maskedValue, description }], count }.',
      parameters: {},
      inputSchema: emptySchema,
      execute: () => {
        const secrets = ctx.env.getGlobalSecretsMasked();
        return { secrets, count: secrets.length };
      },
    },
    {
      name: 'expose_public',
      description:
        'Create a temporary public URL for a project via TryCloudflare tunnel. Use when user wants to share their app externally or test from another device. Returns { status, project, publicUrl }. The URL is temporary and changes on restart. Errors: PROJECT_NOT_FOUND, "not running" if project has no port — deploy it first. For permanent custom domains, use map_domain instead.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to expose',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        if (!project.assigned_port) {
          return { error: 'Project is not running — deploy it first' };
        }

        const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
        return { status: 'exposed', project: projectName, publicUrl: url };
      },
    },
    {
      name: 'unexpose_public',
      description:
        'Remove the public TryCloudflare tunnel URL for a project. Use when user wants to make a project private again. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to unexpose',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        ctx.pipeline.closeTunnel(project.id);
        return Promise.resolve({ status: 'unexposed', project: projectName });
      },
    },
    {
      name: 'get_system_stats',
      description:
        'Get host system resource usage — CPU load, memory, and disk space. Use when user asks about server health, capacity, or before deploying to check if resources are available. Returns { summary, cpu, memory, disk } with percentage usage and warnings. Always available, no errors.',
      parameters: {},
      inputSchema: emptySchema,
      execute: () => {
        const stats = getSystemStats();
        return Promise.resolve({
          summary: formatStatsSummary(stats),
          ...stats,
        });
      },
    },
    {
      name: 'rollback_project',
      description:
        'Rollback a project to its previous Docker image. Use when a recent deploy broke something and user wants to revert. Returns the rollback result with previous image info. Errors: PROJECT_NOT_FOUND, NO_PREVIOUS_IMAGE if this is the first deploy.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to rollback',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        return ctx.pipeline.rollback(project.id);
      },
    },
    {
      name: 'provision_database',
      description:
        'Provision a database sidecar (PostgreSQL or SQLite) for a project. Automatically sets DATABASE_URL in the project env vars and redeploys. Use when user says they need a database. Defaults to PostgreSQL. Returns { status, connectionUrl, type }. Errors: PROJECT_NOT_FOUND, ALREADY_PROVISIONED.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project',
          required: true,
        },
        db_type: {
          type: 'string',
          description: 'Database type: "sqlite" or "postgres" (default: postgres)',
          required: false,
        },
      },
      inputSchema: provisionDbSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        const dbType = (args['db_type'] as string | undefined) === 'sqlite' ? 'sqlite' : 'postgres';
        const result = await ctx.dbProvisioner.provision(project.id, { type: dbType });
        return { status: 'provisioned', project: projectName, ...result };
      },
    },
    {
      name: 'deploy_blue_green',
      description:
        'Deploy a project with zero downtime using blue-green strategy. Builds a new version alongside the current one, runs health checks, then switches traffic atomically. Use for production projects where downtime is unacceptable. Returns deployment result with old/new container info. Errors: PROJECT_NOT_FOUND, HEALTH_CHECK_FAILED (new version unhealthy — old version kept running).',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to deploy',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        return ctx.blueGreen.deploy(project.id);
      },
    },
    {
      name: 'debug_build_error',
      description:
        'Analyze a failed build and suggest fixes using AI. Matches against known error patterns first (fast), then uses LLM analysis (thorough). Use when a deploy_project call failed or user reports a build error. Returns { summary, rootCause, suggestedFixes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project with the build error',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args, { target }) => {
        if (!ctx.buildDebugger) {
          return {
            error:
              target === 'agent'
                ? 'Build debugger requires an LLM provider. Configure one first.'
                : 'Build debugger requires an LLM provider.',
          };
        }

        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        const lastDeploy = ctx.db.getLastDeployLog(project.id);
        if (!lastDeploy || lastDeploy.status !== 'failed') {
          return { error: 'No failed build found for this project.' };
        }

        return ctx.buildDebugger.diagnose({
          buildLog: lastDeploy.build_log ?? 'No build log available',
          projectName,
          imageTag: project.image_tag ?? `openlander/${projectName}:latest`,
          failedStep: 'build',
        });
      },
    },
    {
      name: 'preview_deploy',
      description:
        'Deploy an ephemeral preview environment for a specific branch. Creates a separate container that does not affect the main deployment. Use when user wants to test a PR or feature branch before merging. Returns { previewId, branch, url, port }. The preview is temporary — clean up with cleanup_preview when done.',
      parameters: {
        repo_url: {
          type: 'string',
          description: 'Git repository URL',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch name to preview',
          required: true,
        },
      },
      inputSchema: previewDeploySchema,
      execute: (args) => {
        return ctx.previewDeployer.deploy({
          repoUrl: args['repo_url'] as string,
          branch: args['branch'] as string,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
      },
    },
    {
      name: 'cleanup_preview',
      description:
        'Remove an ephemeral preview deployment created by preview_deploy. Pass the preview_id that was returned. Use when testing is done or to free resources. Returns { status, previewId }. Errors: PREVIEW_NOT_FOUND if the ID is invalid.',
      parameters: {
        preview_id: {
          type: 'string',
          description: 'Preview deployment ID to clean up',
          required: true,
        },
      },
      inputSchema: previewIdSchema,
      execute: async (args) => {
        const previewId = args['preview_id'] as string;
        await ctx.previewDeployer.cleanup(previewId);
        return { status: 'cleaned_up', previewId };
      },
    },
    {
      name: 'list_previews',
      description:
        'List all active preview deployments with branch, URL, port, and creation time. Use to check what previews exist before creating new ones or to find a preview URL. Returns { count, previews[] }. Always available, no errors.',
      parameters: {},
      inputSchema: emptySchema,
      execute: () => {
        const previews = ctx.previewDeployer.list();
        return Promise.resolve({
          count: previews.length,
          previews: previews.map((preview) => ({
            branch: preview.branch,
            url: preview.url,
            port: preview.port,
            createdAt: preview.createdAt.toISOString(),
          })),
        });
      },
    },
    {
      name: 'restart_project',
      description:
        'Restart a running project by stopping and redeploying it with the same configuration. Use when user reports the app is hung, unresponsive, or needs a fresh start after config changes. Returns { status, project } with redeploy result. Errors: PROJECT_NOT_FOUND.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project to restart',
          required: true,
        },
      },
      inputSchema: projectNameSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = getProjectByName(ctx, projectName);
        await ctx.pipeline.stop(project.id);
        const result = await ctx.pipeline.redeploy(project.id);
        return { status: 'restarted', project: projectName, ...result };
      },
    },
    {
      name: 'map_domain',
      description:
        'Map a custom domain to a project via Cloudflare DNS and Tunnel for a permanent public URL. Use when user wants their own domain (e.g., api.myapp.com) instead of a temporary TryCloudflare URL. Requires Cloudflare configuration. Returns { status, project, domain, url }. Errors: PROJECT_NOT_FOUND, CLOUDFLARE_NOT_CONFIGURED.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project',
          required: true,
        },
        domain: {
          type: 'string',
          description: 'Domain to map (e.g., api.myapp.com)',
          required: true,
        },
      },
      inputSchema: domainSchema,
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const domain = args['domain'] as string;
        const project = getProjectByName(ctx, projectName);
        await ctx.cloudflare.createTunnel(project.id, domain);
        return { status: 'mapped', project: projectName, domain, url: `https://${domain}` };
      },
    },
    {
      name: 'list_domains',
      description:
        'List all custom domain mappings across all projects with domain name, project ID, and status. Use to check existing domain configurations. Returns { count, domains[] }. Always available, no errors.',
      parameters: {},
      inputSchema: emptySchema,
      execute: () => {
        const mappings = ctx.db.listDomainMappings();
        return Promise.resolve({
          count: mappings.length,
          domains: mappings.map((mapping) => ({
            domain: mapping.domain,
            projectId: mapping.project_id,
            status: mapping.status,
          })),
        });
      },
    },
    {
      name: 'get_deploy_status',
      description:
        'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed) and timing. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Specific project name to check. Omit for all active deploys.',
          required: false,
        },
      },
      inputSchema: deployStatusSchema,
      execute: (args, { target }) => {
        const projectName = args['project_name'] as string | undefined;

        if (projectName) {
          const project = getProjectByName(ctx, projectName);
          const status = ctx.jobManager.getStatus(project.id);
          const isActive = status && status.phase !== 'done' && status.phase !== 'failed';

          if (target === 'mcp') {
            return Promise.resolve({
              active: isActive ? 1 : 0,
              jobs: status ? [{ name: projectName, phase: status.phase }] : [],
            });
          }

          return Promise.resolve({
            active: isActive ? 1 : 0,
            jobs: status
              ? [
                  {
                    name: projectName,
                    phase: status.phase,
                    elapsed: `${String(Math.round((Date.now() - status.startedAt.getTime()) / 1000))}s`,
                    error: status.errorSummary,
                  },
                ]
              : [],
          });
        }

        const jobs = ctx.jobManager.getActiveJobs();
        if (target === 'mcp') {
          return Promise.resolve({
            active: jobs.length,
            jobs: jobs.map((job) => ({ name: job.projectName, phase: job.phase })),
          });
        }

        return Promise.resolve({
          active: jobs.length,
          jobs: jobs.map((job) => ({
            name: job.projectName,
            phase: job.phase,
            elapsed: `${String(Math.round((Date.now() - job.startedAt.getTime()) / 1000))}s`,
            error: job.errorSummary,
          })),
        });
      },
    },
    {
      name: 'scan_dockerfiles',
      description:
        'Clone a repo and scan for all Dockerfiles. Use BEFORE deploy_project when you suspect a monorepo (multiple services). Returns paths like ["Dockerfile", "frontend/Dockerfile", "backend/Dockerfile"]. If only one Dockerfile is found, use deploy_project normally. If multiple are found, deploy each as a child project with the dockerfile_path parameter. Errors: CLONE_FAILED.',
      parameters: {
        repo_url: {
          type: 'string',
          description: 'Git repository URL to scan',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch to scan (default: main)',
          required: false,
        },
      },
      inputSchema: scanDockerfilesSchema,
      execute: async (args) => {
        const repoUrl = args['repo_url'] as string;
        const branch = (args['branch'] as string | undefined) ?? undefined;
        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        const dockerfiles = findDockerfiles(cloneResult.path);
        const relativePaths = dockerfiles.map((dockerfile) =>
          relative(cloneResult.path, dockerfile),
        );
        return {
          repoUrl,
          clonePath: cloneResult.path,
          commitSha: cloneResult.commitSha,
          dockerfiles: relativePaths,
          isMonorepo: relativePaths.length > 1,
        };
      },
    },
    {
      name: 'deploy_monorepo',
      description:
        'Start deploying a monorepo with multiple services in the background. Use AFTER scan_dockerfiles confirms multiple Dockerfiles. Returns immediately with { parentProjectId, parentName, status: "building" } while all services build in parallel. Use get_deploy_status to check progress. Errors: BUILD_FAILED on individual services (others continue).',
      parameters: {
        repo_url: {
          type: 'string',
          description: 'Git repository URL',
          required: true,
        },
        clone_path: {
          type: 'string',
          description: 'Path to already-cloned repo (from scan_dockerfiles)',
          required: true,
        },
        commit_sha: {
          type: 'string',
          description: 'Commit SHA (from scan_dockerfiles)',
          required: true,
        },
        dockerfiles: {
          type: 'string',
          description:
            'JSON array of Dockerfile paths (from scan_dockerfiles), e.g. ["frontend/Dockerfile", "backend/Dockerfile"]',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch (default: main)',
          required: false,
        },
      },
      inputSchema: deployMonorepoSchema,
      execute: (args) => {
        const dockerfiles = JSON.parse(args['dockerfiles'] as string) as string[];
        const result = ctx.pipeline.startMonorepoDeploy({
          repoUrl: args['repo_url'] as string,
          clonePath: args['clone_path'] as string,
          commitSha: args['commit_sha'] as string,
          dockerfiles,
          branch: (args['branch'] as string | undefined) ?? undefined,
        });
        return Promise.resolve({ ...result, hint: 'Use get_deploy_status to check progress.' });
      },
    },
    {
      name: 'orchestrate_deploy',
      description:
        'Deploy multiple services with dependency ordering and atomic rollback. Use for monorepos or multi-service repos. Internally scans Dockerfiles, reads compose depends_on when available, deploys in topological order, and rolls back all deployed services if any step fails.',
      parameters: {
        repo_url: {
          type: 'string',
          description: 'Git repository URL',
          required: true,
        },
        branch: {
          type: 'string',
          description: 'Branch (default: main)',
          required: false,
        },
      },
      inputSchema: orchestrateDeploySchema,
      execute: async (args) => {
        const repoUrl = args['repo_url'] as string;
        const branch = (args['branch'] as string | undefined) ?? undefined;

        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });

        const dockerfiles = findDockerfiles(cloneResult.path).map((dockerfile) =>
          relative(cloneResult.path, dockerfile),
        );
        const composePath = ctx.composePipeline.detectComposeFile(cloneResult.path);
        const composeProject = composePath
          ? ctx.composePipeline.parseComposeFile(composePath)
          : null;

        const services = buildServiceNodes(
          cloneResult.path,
          dockerfiles,
          composeProject?.services ?? [],
        );
        const orchestrator = new DeployOrchestrator();
        const topology = orchestrator.buildTopology(
          services,
          repoUrl,
          cloneResult.path,
          cloneResult.commitSha,
          branch,
        );

        const usedPorts = (await scanUsedPorts(ctx.db, ctx.docker)).all;
        const validation = orchestrator.validateTopology(topology, usedPorts);
        if (!validation.valid) {
          return {
            success: false,
            services: services.map((service) => ({
              name: service.name,
              status: 'failed' as const,
              error: validation.errors.join('; '),
            })),
            totalDuration: 0,
            error: 'TOPOLOGY_VALIDATION_FAILED',
            validationErrors: validation.errors,
          };
        }

        const deploymentCache = new Map<
          string,
          { success: boolean; projectId?: string; url?: string; error?: string }
        >();

        return orchestrator.executeOrdered(topology, {
          deployService: async (service) => {
            const cached = deploymentCache.get(service.name);
            if (cached) {
              return cached;
            }

            if (!service.dockerfile) {
              const failed = {
                success: false,
                error: `Service ${service.name} has no Dockerfile path`,
              };
              deploymentCache.set(service.name, failed);
              return failed;
            }

            const monorepoResult = await ctx.pipeline.deployMonorepo({
              repoUrl,
              branch,
              clonePath: cloneResult.path,
              commitSha: cloneResult.commitSha,
              dockerfiles: [service.dockerfile],
              envVars: service.envVars,
              trigger: 'api',
            });

            const childResult = monorepoResult.children[0];
            if (!childResult) {
              const failed = {
                success: false,
                error: `No deploy result returned for service ${service.name}`,
              };
              deploymentCache.set(service.name, failed);
              return failed;
            }

            const result = {
              success: childResult.success,
              projectId: childResult.projectId,
              url: childResult.url,
              error: childResult.error,
            };
            deploymentCache.set(service.name, result);
            return result;
          },
          rollbackService: async (service) => {
            if (!service.projectId) {
              return;
            }
            await ctx.pipeline.rollback(service.projectId);
          },
        });
      },
    },
    {
      name: 'list_github_repos',
      description:
        'List repositories from the user\'s connected GitHub account, sorted by most recently pushed. Use when user asks "show my repos", "what can I deploy?", or needs to find a project by name. Returns { count, repos[] } with name, description, language, private flag, and clone URL. Errors: GITHUB_NOT_CONFIGURED if no GitHub token is set — tell user to add one in settings. Supports pagination with page parameter.',
      parameters: {
        page: {
          type: 'number',
          description: 'Page number for pagination (default: 1, 30 repos per page)',
          required: false,
        },
        visibility: {
          type: 'string',
          description: 'Filter by visibility: "all", "public", or "private" (default: all)',
          required: false,
        },
      },
      inputSchema: listGithubReposSchema,
      execute: async (args, { target }) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          if (target === 'agent') {
            return {
              error: 'GITHUB_NOT_CONFIGURED',
              message: 'No GitHub token configured. Add one in settings to browse repos.',
            };
          }

          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured.',
          };
        }

        const provider = createGitProvider('github', ghConfig);
        const pageArg = args['page'] as number | undefined;
        const visibilityArg = args['visibility'] as 'all' | 'public' | 'private' | undefined;
        const page = target === 'agent' ? (pageArg ?? 1) : pageArg;
        const visibility = target === 'agent' ? (visibilityArg ?? 'all') : visibilityArg;
        const result = await provider.listRepos({ page, perPage: 30, visibility });

        if (target === 'mcp') {
          return {
            count: result.repos.length,
            hasMore: result.hasMore,
            repos: result.repos.map((repo) => ({
              name: repo.name,
              fullName: repo.fullName,
              description: repo.description,
              language: repo.language,
              private: repo.isPrivate,
              cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
              htmlUrl: repo.htmlUrl,
            })),
          };
        }

        return {
          count: result.repos.length,
          hasMore: result.hasMore,
          repos: result.repos.map((repo) => ({
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            defaultBranch: repo.defaultBranch,
            stars: repo.stars,
            cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
            updatedAt: repo.updatedAt,
          })),
        };
      },
    },
    {
      name: 'search_github_repos',
      description:
        'Search the user\'s GitHub repositories by name or keyword. Use when user says "deploy my-project" or "find repo X" — this resolves a project name to a deployable repo URL. Returns { total, repos[] } with clone URLs ready for deploy_project. Errors: GITHUB_NOT_CONFIGURED. Tip: after finding the repo, call deploy_project with the clone URL.',
      parameters: {
        query: {
          type: 'string',
          description: 'Search query — matches repo name, description, and README',
          required: true,
        },
      },
      inputSchema: searchGithubReposSchema,
      execute: async (args, { target }) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          if (target === 'agent') {
            return {
              error: 'GITHUB_NOT_CONFIGURED',
              message: 'No GitHub token configured. Add one in settings to search repos.',
            };
          }

          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured.',
          };
        }

        const provider = createGitProvider('github', ghConfig);
        const query = args['query'] as string;
        const result = await provider.searchRepos(query);

        if (target === 'mcp') {
          return {
            total: result.total,
            repos: result.repos.map((repo) => ({
              name: repo.name,
              fullName: repo.fullName,
              description: repo.description,
              language: repo.language,
              private: repo.isPrivate,
              cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
              htmlUrl: repo.htmlUrl,
            })),
          };
        }

        return {
          total: result.total,
          repos: result.repos.map((repo) => ({
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description,
            language: repo.language,
            private: repo.isPrivate,
            defaultBranch: repo.defaultBranch,
            cloneUrl: repo.isPrivate ? provider.getAuthCloneUrl(repo.fullName) : repo.cloneUrl,
            htmlUrl: repo.htmlUrl,
          })),
        };
      },
    },
    {
      name: 'list_all_containers',
      description:
        'List all Docker containers on the server, including those not managed by OpenLander. Use to see the full server state, detect external services, or find containers by state. Returns { count, containers[] } with id, name, image, state, status, ports, and managedByOpenLander flag.',
      parameters: {
        state: {
          type: 'string',
          description: 'Filter by state: "all" (default), "running", or "stopped"',
          required: false,
        },
      },
      inputSchema: listAllContainersSchema,
      execute: async (args) => {
        const state = (args['state'] as 'all' | 'running' | 'stopped' | undefined) ?? 'all';
        const containers = await ctx.docker.listAllContainers();

        const filtered =
          state === 'all'
            ? containers
            : containers.filter((c) =>
                state === 'running' ? c.state === 'running' : c.state !== 'running',
              );

        return {
          count: filtered.length,
          containers: filtered.map((c) => ({
            id: c.id,
            name: c.name,
            image: c.image,
            state: c.state,
            status: c.status,
            ports: c.ports,
            managedByOpenLander: c.managedByOpenLander,
            composeProject: c.composeProject,
          })),
        };
      },
    },
    {
      name: 'scan_ports',
      description:
        'Scan all ports in use on the server from 3 sources: OpenLander database, Docker containers, and OS-level processes. Use to check port availability before deploying or to debug port conflicts. Returns { db, docker, os, all, conflicts } where conflicts are ports 80, 443, 8080.',
      parameters: {},
      inputSchema: emptySchema,
      execute: async () => {
        const result = await scanUsedPorts(ctx.db, ctx.docker);
        return {
          db: result.db,
          docker: result.docker,
          os: result.os,
          all: result.all,
          conflicts: result.conflicts,
        };
      },
    },
    {
      name: 'get_container_stats',
      description:
        'Get real-time resource usage (CPU, memory, network) for a specific container by name or ID. Use when user asks about container performance or resource consumption. Returns { container, cpuPercent, memoryUsage, memoryPercent, networkRx, networkTx } or { error } if container not found.',
      parameters: {
        container: {
          type: 'string',
          description: 'Container name or ID',
          required: true,
        },
      },
      inputSchema: getContainerStatsSchema,
      execute: async (args) => {
        const containerId = args['container'] as string;
        try {
          const dockerClient = ctx.docker.getClient();
          const container = dockerClient.getContainer(containerId);
          const rawStats = await container.stats({ stream: false });
          // Cast to partial types for runtime safety (Docker API may omit fields)
          const stats = rawStats as {
            cpu_stats: {
              cpu_usage: { total_usage: number; percpu_usage?: number[] };
              system_cpu_usage: number;
            };
            precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
            memory_stats: { usage?: number; limit?: number };
            networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
          };

          // Calculate CPU percentage
          const cpuDelta =
            stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
          const systemDelta =
            stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
          const cpuPercent =
            systemDelta > 0 && cpuDelta > 0
              ? (cpuDelta / systemDelta) *
                (stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1) *
                100
              : 0;

          // Memory usage
          const memoryUsage = stats.memory_stats.usage ?? 0;
          const memoryLimit = stats.memory_stats.limit ?? 1;
          const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

          // Network I/O
          const networks = stats.networks ?? {};
          let networkRx = 0;
          let networkTx = 0;
          for (const iface of Object.values(networks)) {
            const net = iface as { rx_bytes?: number; tx_bytes?: number };
            networkRx += net.rx_bytes ?? 0;
            networkTx += net.tx_bytes ?? 0;
          }

          return {
            container: containerId,
            cpuPercent: Math.round(cpuPercent * 100) / 100,
            memoryMB: Math.round(memoryUsage / (1024 * 1024)),
            memoryPercent: Math.round(memoryPercent * 100) / 100,
            networkRxMB: Math.round(networkRx / (1024 * 1024)),
            networkTxMB: Math.round(networkTx / (1024 * 1024)),
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('not found') || msg.includes('No such container')) {
            return { error: `Container "${containerId}" not found.` };
          }
          return { error: `Failed to get stats: ${msg}` };
        }
      },
    },
  ];

  if (!target) {
    return tools;
  }

  return tools.filter((tool) => tool.targets?.includes(target) ?? true);
}

function getProjectByName(ctx: AppContext, name: string) {
  const project = ctx.db.getProjectByName(name);
  if (!project) {
    throw new ProjectNotFoundError(name);
  }
  return project;
}

function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];

  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (err) {
      log.debug({ err, current }, 'Failed to read directory during Dockerfile scan');
      return;
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') {
        continue;
      }

      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === 'Dockerfile') {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch (err) {
        log.debug({ err, fullPath }, 'Failed to stat file during Dockerfile scan');
        continue;
        continue;
      }
    }
  }

  walk(dir, 0);
  return results;
}

function buildServiceNodes(
  clonePath: string,
  dockerfiles: string[],
  composeServices: Array<{
    name: string;
    build?: string | { context: string; dockerfile?: string };
    dependsOn?: string[];
    ports?: string[];
    environment?: Record<string, string> | string[];
  }>,
): ServiceNode[] {
  const composeByName = new Map(composeServices.map((service) => [service.name, service]));
  const composeByDockerfile = new Map<string, (typeof composeServices)[number]>();

  for (const service of composeServices) {
    const dockerfilePath = deriveDockerfileFromComposeBuild(service.build);
    if (!dockerfilePath) {
      continue;
    }
    composeByDockerfile.set(
      normalizeRelativePath(join(clonePath, dockerfilePath), clonePath),
      service,
    );
  }

  return dockerfiles.map((dockerfilePath) => {
    const normalizedDockerfile = normalizeRelativePath(join(clonePath, dockerfilePath), clonePath);
    const serviceName = deriveServiceName(dockerfilePath);
    const composeService =
      composeByName.get(serviceName) ?? composeByDockerfile.get(normalizedDockerfile);
    const envVars = parseComposeEnvVars(composeService?.environment);
    return {
      name: composeService?.name ?? serviceName,
      dockerfile: dockerfilePath,
      dependsOn: composeService?.dependsOn ?? [],
      port: parseComposeHostPort(composeService?.ports?.[0]),
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    };
  });
}

function deriveServiceName(dockerfilePath: string): string {
  const normalized = dockerfilePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return 'app';
  }
  return parts[parts.length - 2] ?? 'app';
}

function parseComposeHostPort(portMapping?: string): number | undefined {
  if (!portMapping) {
    return undefined;
  }
  const cleaned = portMapping.trim().split('/')[0] ?? portMapping;
  const tokens = cleaned
    .split(':')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length < 2) {
    return undefined;
  }
  const hostPortToken = tokens[tokens.length - 2];
  if (!hostPortToken || !/^\d+$/.test(hostPortToken)) {
    return undefined;
  }
  const parsed = Number(hostPortToken);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseComposeEnvVars(
  environment?: Record<string, string> | string[],
): Record<string, string> {
  if (!environment) {
    return {};
  }
  if (!Array.isArray(environment)) {
    return { ...environment };
  }
  const vars: Record<string, string> = {};
  for (const item of environment) {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }
    vars[key] = value;
  }
  return vars;
}

function deriveDockerfileFromComposeBuild(
  build?: string | { context: string; dockerfile?: string },
): string | null {
  if (!build) {
    return null;
  }
  if (typeof build === 'string') {
    return join(build, 'Dockerfile');
  }
  return join(build.context, build.dockerfile ?? 'Dockerfile');
}

function normalizeRelativePath(pathToNormalize: string, root: string): string {
  return relative(root, pathToNormalize).replace(/\\/g, '/');
}
