import type { AppContext } from '../app.js';
import type { QuestionBridge } from './question-bridge.js';
import { getSystemStats, formatStatsSummary } from '../monitor/stats.js';
import { ProjectNotFoundError } from '../errors.js';
import { cloneRepo } from '../pipeline/git.js';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createGitProvider } from '../git-providers/index.js';
import { loadConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('agent-tools');

/**
 * Tool definitions for the OpenLander agent.
 *
 * Each tool maps to a pipeline operation.
 * The LLM calls these via function calling — execution is deterministic.
 *
 * Description format (per tool-design best practice):
 *   What it does → When to use → Returns → Errors → Notes
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

/**
 * Create tools wired to the application context.
 *
 * v0.1 tools:
 * - deploy_project: Deploy from a git repo URL
 * - stop_project: Stop a running container
 * - remove_project: Remove a project entirely
 * - get_logs: Get container logs
 * - list_projects: List all projects
 * - set_env_vars: Set environment variables
 * - expose_public: Create a TryCloudflare tunnel
 * - unexpose_public: Remove public URL
 * - get_system_stats: Host resource usage
 * v0.2 tools (new):
 * - restart_project: Restart a running container
 * - map_domain: Map a custom domain via Cloudflare
 * - list_domains: List all domain mappings
 * v0.3 tools:
 * - rollback_project: Rollback to previous image
 * - provision_database: Provision a database sidecar
 * - deploy_blue_green: Zero-downtime deployment
 * - debug_build_error: Analyze build failures with LLM
 * v0.4 tools:
 * - preview_deploy: Ephemeral branch preview
 * - cleanup_preview: Remove preview
 * - list_previews: List active previews
 */
export function createTools(ctx: AppContext, questionBridge?: QuestionBridge): ToolDefinition[] {
  return [
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
      execute: (args) => {
        const result = ctx.pipeline.startDeploy({
          repoUrl: args['repo_url'] as string,
          branch: (args['branch'] as string | undefined) ?? undefined,
          name: (args['name'] as string | undefined) ?? undefined,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          trigger: 'chat',
        });
        return Promise.resolve({ ...result, hint: 'Use get_deploy_status to check progress.' });
      },
    },
    {
      name: 'deploy_compose',
      description:
        'Deploy a project that uses Docker Compose (multi-service). Auto-detected when compose file exists. Returns parent project with service statuses. Errors: COMPOSE_FILE_NOT_FOUND, BUILD_FAILED.',
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
        name: {
          type: 'string',
          description: 'Project name (auto-generated from repo if omitted)',
          required: false,
        },
      },
      execute: async (args) => {
        const repoUrl = args['repo_url'] as string;
        const branch = (args['branch'] as string | undefined) ?? undefined;
        const name = (args['name'] as string | undefined) ?? undefined;

        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });

        const composePath = ctx.composePipeline.detectComposeFile(cloneResult.path);
        if (!composePath) {
          return {
            error: 'COMPOSE_FILE_NOT_FOUND',
            message: 'No compose file found in repository.',
          };
        }

        const result = await ctx.composePipeline.deployCompose({
          repoUrl,
          branch,
          clonePath: cloneResult.path,
          composePath,
          name,
          trigger: 'chat',
        });

        if (!result.success) {
          return {
            error: 'BUILD_FAILED',
            message: result.error ?? 'Compose deploy failed.',
            ...result,
          };
        }

        return result;
      },
    },
    {
      name: 'list_compose_services',
      description:
        'List services in a Docker Compose project with per-service status, ports, and container IDs.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Compose project name',
          required: true,
        },
      },
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const services = await ctx.composePipeline.getServiceStatuses(project.id);
        return {
          project: projectName,
          count: services.length,
          services,
        };
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        await ctx.pipeline.remove(project.id);
        return { status: 'removed', project: projectName };
      },
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const lines = (args['lines'] as number | undefined) ?? 20;
        const logs = await ctx.pipeline.getLogs(project.id, lines);
        return { project: projectName, logs };
      },
    },
    {
      name: 'list_projects',
      description:
        'List all deployed projects with name, status (running/stopped/error), ports, local URLs, and public URLs. Use as the first tool when user asks about their projects, or to verify a project name before other operations. Returns { count, projects[] }. Always available, no errors.',
      parameters: {},
      execute: () => {
        const projects = ctx.db.listProjects();
        return Promise.resolve({
          count: projects.length,
          projects: projects.map((p) => ({
            name: p.name,
            status: p.status,
            visibility: p.visibility,
            port: p.assigned_port,
            url: p.assigned_port ? `http://${p.name}.localhost` : null,
            publicUrl: p.public_url,
            repoUrl: p.repo_url,
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const vars = JSON.parse(args['variables'] as string) as Record<string, string>;
        const changed = ctx.env.setBulk(project.id, vars);

        if (changed && project.status === 'running') {
          // Redeploy with new env vars
          await ctx.pipeline.redeploy(project.id);
          return {
            status: 'updated_and_redeployed',
            project: projectName,
            keys: Object.keys(vars),
          };
        }

        return { status: 'updated', project: projectName, keys: Object.keys(vars) };
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);
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
      execute: (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        ctx.pipeline.closeTunnel(project.id);
        return Promise.resolve({ status: 'unexposed', project: projectName });
      },
    },
    {
      name: 'get_system_stats',
      description:
        'Get host system resource usage — CPU load, memory, and disk space. Use when user asks about server health, capacity, or before deploying to check if resources are available. Returns { summary, cpu, memory, disk } with percentage usage and warnings. Always available, no errors.',
      parameters: {},
      execute: () => {
        const stats = getSystemStats();
        return Promise.resolve({
          summary: formatStatsSummary(stats),
          ...stats,
        });
      },
    },
    // --- v0.3 Tools ---
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const result = await ctx.pipeline.rollback(project.id);
        return result;
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const result = await ctx.blueGreen.deploy(project.id);
        return result;
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
      execute: async (args) => {
        if (!ctx.buildDebugger) {
          return { error: 'Build debugger requires an LLM provider. Configure one first.' };
        }

        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const lastDeploy = ctx.db.getLastDeployLog(project.id);
        if (!lastDeploy || lastDeploy.status !== 'failed') {
          return { error: 'No failed build found for this project.' };
        }

        const diagnosis = await ctx.buildDebugger.diagnose({
          buildLog: lastDeploy.build_log ?? 'No build log available',
          projectName,
          imageTag: project.image_tag ?? `openlander/${projectName}:latest`,
          failedStep: 'build',
        });

        return diagnosis;
      },
    },
    // --- v0.4 Tools ---
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
      execute: async (args) => {
        const result = await ctx.previewDeployer.deploy({
          repoUrl: args['repo_url'] as string,
          branch: args['branch'] as string,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        return result;
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
      execute: () => {
        const previews = ctx.previewDeployer.list();
        return Promise.resolve({
          count: previews.length,
          previews: previews.map((p) => ({
            branch: p.branch,
            url: p.url,
            port: p.port,
            createdAt: p.createdAt.toISOString(),
          })),
        });
      },
    },
    // --- v0.2 Tools (added in agent enhancement) ---
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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

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
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const domain = args['domain'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        await ctx.cloudflare.createTunnel(project.id, domain);
        return { status: 'mapped', project: projectName, domain, url: `https://${domain}` };
      },
    },
    {
      name: 'list_domains',
      description:
        'List all custom domain mappings across all projects with domain name, project ID, and status. Use to check existing domain configurations. Returns { count, domains[] }. Always available, no errors.',
      parameters: {},
      execute: () => {
        const mappings = ctx.db.listDomainMappings();
        return Promise.resolve({
          count: mappings.length,
          domains: mappings.map((m) => ({
            domain: m.domain,
            projectId: m.project_id,
            status: m.status,
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
      execute: (args) => {
        const projectName = args['project_name'] as string | undefined;
        if (projectName) {
          const project = ctx.db.getProjectByName(projectName);
          if (!project) throw new ProjectNotFoundError(projectName);
          const status = ctx.jobManager.getStatus(project.id);
          const isActive = status && status.phase !== 'done' && status.phase !== 'failed';
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
        return Promise.resolve({
          active: jobs.length,
          jobs: jobs.map((j) => ({
            name: j.projectName,
            phase: j.phase,
            elapsed: `${String(Math.round((Date.now() - j.startedAt.getTime()) / 1000))}s`,
            error: j.errorSummary,
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
      execute: async (args) => {
        const repoUrl = args['repo_url'] as string;
        const branch = (args['branch'] as string | undefined) ?? undefined;
        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        });
        const dockerfiles = findDockerfiles(cloneResult.path);
        const relativePaths = dockerfiles.map((f) => relative(cloneResult.path, f));
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
    // --- Git Provider Tools ---
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
      execute: async (args) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to browse repos.',
          };
        }
        const provider = createGitProvider('github', ghConfig);
        const page = (args['page'] as number | undefined) ?? 1;
        const visibility =
          (args['visibility'] as 'all' | 'public' | 'private' | undefined) ?? 'all';
        const result = await provider.listRepos({ page, perPage: 30, visibility });
        return {
          count: result.repos.length,
          hasMore: result.hasMore,
          repos: result.repos.map((r) => ({
            name: r.name,
            fullName: r.fullName,
            description: r.description,
            language: r.language,
            private: r.isPrivate,
            defaultBranch: r.defaultBranch,
            stars: r.stars,
            cloneUrl: r.isPrivate ? provider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
            htmlUrl: r.htmlUrl,
            updatedAt: r.updatedAt,
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
      execute: async (args) => {
        const config = loadConfig();
        const ghConfig = config.gitProviders.github;
        if (!ghConfig.token) {
          return {
            error: 'GITHUB_NOT_CONFIGURED',
            message: 'No GitHub token configured. Add one in settings to search repos.',
          };
        }
        const provider = createGitProvider('github', ghConfig);
        const query = args['query'] as string;
        const result = await provider.searchRepos(query);
        return {
          total: result.total,
          repos: result.repos.map((r) => ({
            name: r.name,
            fullName: r.fullName,
            description: r.description,
            language: r.language,
            private: r.isPrivate,
            defaultBranch: r.defaultBranch,
            cloneUrl: r.isPrivate ? provider.getAuthCloneUrl(r.fullName) : r.cloneUrl,
            htmlUrl: r.htmlUrl,
          })),
        };
      },
    },
    // --- v0.5 Tools: Alerts ---
    {
      name: 'get_alerts',
      description:
        'Get current system alerts for resource issues, inactive projects, and container problems. Returns active alerts with severity, message, and suggested actions. Use when user asks about system health, problems, or "show alerts". Always available.',
      parameters: {},
      execute: () => {
        const alerts = ctx.alertMonitor.getActiveAlerts();
        return Promise.resolve({
          count: alerts.length,
          alerts: alerts.map((a) => ({
            id: a.id,
            type: a.type,
            severity: a.severity,
            message: a.message,
            suggestion: a.suggestion,
            createdAt: a.createdAt.toISOString(),
          })),
        });
      },
    },
    {
      name: 'dismiss_alert',
      description:
        'Dismiss a specific alert by ID so it no longer appears in active alerts. Use when user acknowledges an alert. Returns { status, alertId }.',
      parameters: {
        alert_id: { type: 'string', description: 'Alert ID to dismiss', required: true },
      },
      execute: (args) => {
        const alertId = args['alert_id'] as string;
        ctx.alertMonitor.dismissAlert(alertId);
        return Promise.resolve({ status: 'dismissed', alertId });
      },
    },
    // --- v0.7 Tools: User Interaction ---
    ...(questionBridge
      ? [
          {
            name: 'ask_user_question',
            description:
              "Ask the user a question with structured choices during a conversation. Use when you need to gather preferences, clarify ambiguous instructions, get decisions on implementation choices, or offer options. Each question has a header (max 30 chars), a question string, and an array of options with label (1-5 words) and description. A 'Type your own answer' option is automatically added. If you recommend a specific option, list it first and add '(Recommended)' to its label. Set multiple=true to allow multi-select. Returns an array of answers, each with selectedLabels (array of chosen label strings) and optional customText.",
            parameters: {
              questions: {
                type: 'string' as const,
                description:
                  'JSON array of question objects. Each: { question: string, header?: string (max 30 chars), options: [{ label: string (1-5 words), description?: string }], multiple?: boolean }',
                required: true,
              },
            },
            execute: async (args: Record<string, unknown>) => {
              const questionsRaw = args['questions'] as string;
              const questions = JSON.parse(questionsRaw) as Array<{
                question: string;
                header?: string;
                options: Array<{ label: string; description?: string }>;
                multiple?: boolean;
              }>;
              const { nanoid } = await import('nanoid');
              const request = {
                id: nanoid(12),
                questions: questions.map((q) => ({
                  question: q.question,
                  header: q.header?.slice(0, 30),
                  options: q.options.map((o) => ({
                    label: o.label.slice(0, 30),
                    description: o.description,
                  })),
                  multiple: q.multiple ?? false,
                })),
              };
              const answers = await questionBridge.ask(request);
              if (answers.length === 0) {
                return {
                  dismissed: true,
                  message: 'User dismissed the question without answering.',
                };
              }
              return {
                answers: answers.map((a) => ({
                  questionIndex: a.questionIndex,
                  selectedLabels: a.selectedLabels,
                  customText: a.customText,
                })),
              };
            },
          } satisfies ToolDefinition,
        ]
      : []),
  ];
}

/**
 * Legacy TOOLS export for backward compatibility.
 * Use createTools(ctx) for wired tools.
 */
export const TOOLS: ToolDefinition[] = [];

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
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') continue;
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
      }
    }
  }
  walk(dir, 0);
  return results;
}
