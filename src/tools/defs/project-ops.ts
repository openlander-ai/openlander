import { ProjectNotFoundError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import {
  emptySchema,
  removeProjectSchema,
  restartProjectSchema,
  stopProjectSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-project-ops');

async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
  let client: ReturnType<typeof appCtx.docker.getClient>;
  try {
    client = appCtx.docker.getClient();
  } catch {
    return;
  }

  const projects = appCtx.db.listProjects();

  for (const project of projects) {
    if (project.status !== 'running' || !project.container_id) {
      continue;
    }

    try {
      const info = await client.getContainer(project.container_id).inspect();
      const status = info.State.Running ? 'running' : 'stopped';

      if (status !== project.status || info.Id !== project.container_id) {
        appCtx.db.updateProject(project.id, { status, containerId: info.Id });
      }
    } catch (err) {
      log.debug(
        { err, projectId: project.id, containerId: project.container_id },
        'Failed to inspect project container',
      );
      appCtx.db.updateProject(project.id, { status: 'error' });
    }
  }
}

export const projectOpsToolDefs: ToolDef[] = [
  {
    name: 'stop_project',
    description:
      'Stop a running project container gracefully. Use when user wants to pause or shut down a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND — use list_projects to find valid names. Does NOT remove the project; use remove_project for full cleanup.',
    mcpDescription:
      'Stop a running project container. Does NOT remove it — use remove_project for full cleanup. The project can be restarted with restart_project.',
    inputSchema: stopProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.stop(project.id);
      return { status: 'stopped', project: projectName };
    },
  },
  {
    name: 'remove_project',
    description:
      'Permanently remove a project — deletes the container, image, and database record. DESTRUCTIVE — cannot be undone. WARNING: Port assignment is lost; re-deploying the same project name will get a DIFFERENT port, breaking any hardcoded port references (env vars, URLs). To update code and redeploy without losing the port, use restart_project instead. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription:
      'DESTRUCTIVE: Permanently remove a project — deletes container, image, and database record. Port assignment is lost; re-deploying gets a DIFFERENT port. To update code without losing the port, use restart_project instead.',
    inputSchema: removeProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.remove(project.id, context.appCtx.cloudflare);
      return { status: 'removed', project: projectName };
    },
  },
  {
    name: 'list_projects',
    description:
      'List all deployed projects with name, status (running/stopped/error), ports, local URLs, and public URLs. Use as the first tool when user asks about their projects, or to verify a project name before other operations. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      "List all deployed projects with status (running/stopped/error/building), ports, and URLs. Status is reconciled with Docker on each call — if a container was removed externally, status updates to 'error'. Use as first tool to discover project names before other operations.",
    inputSchema: emptySchema,
    execute: async (_args, context) => {
      if (context.target === 'mcp') {
        await reconcileRunningProjects(context.appCtx);
      }

      const projects = context.appCtx.db.listProjects();

      if (context.target === 'mcp') {
        return {
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
            urls: project.assigned_port ? getProjectUrls(project.name) : [],
            publicUrl: project.public_url,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
          })),
        };
      }

      return {
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
      };
    },
  },
  {
    name: 'restart_project',
    description:
      'Restart a running project by stopping and redeploying it with the same configuration. Use when user reports the app is hung, unresponsive, or needs a fresh start after config changes. Returns { status, project } with redeploy result. Errors: PROJECT_NOT_FOUND.',
    mcpDescription:
      'Restart a project by stopping and redeploying. Returns IMMEDIATELY — does NOT wait for build to complete. Use get_deploy_status to track progress. Use no_cache=true to force a clean rebuild.',
    inputSchema: restartProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const noCache = (args['no_cache'] as boolean | undefined) === true;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.stop(project.id);
      void context.appCtx.pipeline.redeploy(project.id, { noCache }).catch((err: unknown) => {
        log.error({ err, projectId: project.id }, 'Restart redeploy failed');
      });

      return {
        status: 'restarting',
        project: projectName,
        message: 'Redeployment started. Use get_deploy_status to track progress.',
      };
    },
  },
];
