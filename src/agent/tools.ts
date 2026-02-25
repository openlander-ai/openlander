import type { AppContext } from '../app.js';
import { getSystemStats, formatStatsSummary } from '../monitor/stats.js';
import { ProjectNotFoundError } from '../errors.js';

/**
 * Tool definitions for the OpenLander agent.
 *
 * Each tool maps to a pipeline operation.
 * The LLM calls these via function calling — execution is deterministic.
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
export function createTools(ctx: AppContext): ToolDefinition[] {
  return [
    {
      name: 'deploy_project',
      description:
        'Deploy a project from a git repository URL. Clones, builds, and runs the container.',
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
      execute: async (args) => {
        const result = await ctx.pipeline.deploy({
          repoUrl: args['repo_url'] as string,
          branch: (args['branch'] as string | undefined) ?? undefined,
          name: (args['name'] as string | undefined) ?? undefined,
          sshKeyPath: ctx.config.git.sshKeyPath || undefined,
          trigger: 'chat',
        });
        return result;
      },
    },
    {
      name: 'stop_project',
      description: 'Stop a running project container.',
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
      description: 'Remove a project and its container entirely.',
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
      description: 'Get recent container logs for a project.',
      parameters: {
        project_name: {
          type: 'string',
          description: 'Name of the project',
          required: true,
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to return (default: 50)',
          required: false,
        },
      },
      execute: async (args) => {
        const projectName = args['project_name'] as string;
        const project = ctx.db.getProjectByName(projectName);
        if (!project) throw new ProjectNotFoundError(projectName);

        const lines = (args['lines'] as number | undefined) ?? 50;
        const logs = await ctx.pipeline.getLogs(project.id, lines);
        return { project: projectName, logs };
      },
    },
    {
      name: 'list_projects',
      description: 'List all deployed projects with their status and URLs.',
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
      description: 'Set environment variables for a project. Triggers a redeploy.',
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
        'Create a public URL for a project via TryCloudflare. Generates a temporary public URL.',
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
      description: 'Remove the public URL for a project.',
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
      description: 'Get host system resource usage (CPU, memory, disk).',
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
      description: 'Rollback a project to its previous Docker image. Useful when a deploy broke something.',
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
      description: 'Provision a database (SQLite or PostgreSQL) for a project. Sets DATABASE_URL env var automatically.',
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
      description: 'Deploy a project with zero downtime using blue-green strategy. Builds new version, health-checks it, then switches traffic.',
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
      description: 'Analyze a failed build and suggest fixes using AI. Reads build logs and Dockerfile to diagnose the issue.',
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
      description: 'Deploy an ephemeral preview environment for a specific branch. Great for testing PRs before merging.',
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
      description: 'Remove an ephemeral preview deployment. Pass the preview ID returned by preview_deploy.',
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
      description: 'List all active preview deployments.',
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
      description: 'Restart a running project container. Stops and starts it again with the same configuration.',
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
        return { status: 'restarted', project: projectName };
      },
    },
    {
      name: 'map_domain',
      description: 'Map a custom domain to a project via Cloudflare DNS and Tunnel. Requires Cloudflare to be configured.',
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
      description: 'List all custom domain mappings across all projects.',
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
  ];
}

/**
 * Legacy TOOLS export for backward compatibility.
 * Use createTools(ctx) for wired tools.
 */
export const TOOLS: ToolDefinition[] = [];
