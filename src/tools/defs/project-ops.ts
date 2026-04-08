import { nanoid } from 'nanoid';
import { DeployLockedError, ProjectNotFoundError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import {
  emptySchema,
  archiveProjectSchema,
  unarchiveProjectSchema,
  restartProjectSchema,
  stopProjectSchema,
  startProjectSchema,
  redeployProjectSchema,
  updateProjectConfigSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-project-ops');

function buildDeployLockedResponse(error: DeployLockedError) {
  return {
    success: false,
    error: 'DEPLOY_LOCKED',
    message: error.message,
    _agent_guidance: {
      message: 'Another deploy is in progress for this project.',
      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
    },
  };
}

function tryAcquireDeployLockOrResponse(
  projectId: string,
  sessionId: string,
  context: Parameters<ToolDef['execute']>[1],
) {
  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
  if (locked) {
    return null;
  }
  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
  return buildDeployLockedResponse(error);
}

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
    riskLevel: 'medium',
    description:
      'Stop a running project container gracefully. Use when user wants to pause or shut down a project. Returns { status, project }. Errors: PROJECT_NOT_FOUND — use list_projects to find valid names. Does NOT remove the project; use archive_project for full cleanup.',
    mcpDescription: 'Stop a running project container.',
    inputSchema: stopProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      if (project.status === 'building') {
        context.appCtx.docker.cancelBuild(project.id);
      }

      await context.appCtx.pipeline.stop(project.id);
      return {
        status: 'stopped',
        project: projectName,
        _agent_guidance: {
          next_steps: [
            'Call restart_project to start the project again, or archive_project to delete it entirely.',
          ],
        },
      };
    },
  },

  {
    name: 'list_projects',
    riskLevel: 'low',
    description:
      'List all deployed projects with name, status (running/stopped/error), ports, containerName (for inter-project communication via Docker network, e.g. http://ol-myapp:3000), local URLs, and public URLs. Use as the first tool when user asks about their projects, or to verify a project name before other operations. Returns { count, projects[] }. Always available, no errors.',
    mcpDescription:
      'List all deployed projects with status, ports, and URLs. For container-to-container communication, use http://ol-{name}:{port}. containerName field shows Docker internal DNS name. All projects share the openlander Docker network. Do NOT create networks manually.',
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
            containerName: project.container_id ? projectContainerName(project.name) : null,
            network: SHARED_NETWORK_NAME,
            url: project.assigned_port ? getProjectUrl(project.name) : null,
            urls: project.assigned_port ? getProjectUrls(project.name) : [],
            publicUrl: project.public_url,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
          })),
          _agent_guidance: {
            networking: [
              `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
              'For inter-container communication, use http://ol-{project-name}:{port} (DNS auto-resolved).',
              'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
            ],
          },
        };
      }

      return {
        count: projects.length,
        projects: projects.map((project) => ({
          name: project.name,
          status: project.status,
          visibility: project.visibility,
          port: project.assigned_port,
          containerName: project.container_id ? projectContainerName(project.name) : null,
          url: project.assigned_port ? getProjectUrl(project.name) : null,
          publicUrl: project.public_url,
          repoUrl: project.repo_url,
        })),
      };
    },
  },
  {
    name: 'restart_project',
    riskLevel: 'medium',
    description:
      'Restart a running project by stopping and redeploying it with the same configuration. Use when user reports the app is hung, unresponsive, or needs a fresh start after config changes. Returns { status, project, message }. Redeploy runs in background — poll get_deploy_status. Errors: PROJECT_NOT_FOUND.',
    mcpDescription:
      'Restart a project by stopping and redeploying. Pass no_cache=true to rebuild from scratch (use when dependencies changed but Docker layers stale).',
    inputSchema: restartProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const noCache = (args['no_cache'] as boolean | undefined) === true;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.stop(project.id);

      const release = await context.appCtx.deployQueue.acquire();
      void context.appCtx.pipeline
        .redeploy(project.id, { noCache })
        .catch((err: unknown) => {
          log.error({ err, projectId: project.id }, 'Restart redeploy failed');
        })
        .finally(() => {
          release();
        });

      return {
        status: 'restarting',
        project: projectName,
        message: noCache
          ? 'Restart initiated (no_cache). Full rebuild may take 3-5+ minutes. Poll get_deploy_status to track progress.'
          : 'Redeployment started. Poll get_deploy_status to track progress.',
      };
    },
  },
  {
    name: 'start_project',
    riskLevel: 'medium',
    description:
      'Start a stopped project container. Use when user wants to resume a paused project. Returns { status, project }. Errors: PROJECT_NOT_FOUND — use list_projects to find valid names. Does NOT redeploy; use restart_project to redeploy with code changes.',
    mcpDescription: 'Start a stopped project container.',
    inputSchema: startProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.start(project.id);
      return {
        status: 'started',
        project: projectName,
        _agent_guidance: {
          next_steps: [
            'Call list_projects to verify the project is running, or stop_project to pause it again.',
          ],
        },
      };
    },
  },
  {
    name: 'redeploy_project',
    riskLevel: 'medium',
    description:
      'Redeploy a project with the same configuration and code. Use when user wants to rebuild and restart without code changes, or to apply environment variable updates. Returns { status, project }. Errors: PROJECT_NOT_FOUND. Pass no_cache=true to rebuild from scratch (use when dependencies changed but Docker layers stale).',
    mcpDescription:
      'Redeploy a project with the same configuration. Pass no_cache=true to rebuild from scratch.',
    inputSchema: redeployProjectSchema,
    execute: (args, context) => {
      const projectName = args['project_name'] as string;
      const toolSessionId = `mcp-redeploy-${nanoid(12)}`;
      const noCache = (args['no_cache'] as boolean | undefined) === true;
      const strategy = args['strategy'] as 'blue-green' | 'force' | undefined;
      const healthCheckPath = args['health_check_path'] as string | undefined;
      const cmd = args['cmd'] as string[] | undefined;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      const lockResult = tryAcquireDeployLockOrResponse(project.id, toolSessionId, context);
      if (lockResult) {
        return lockResult;
      }

      void context.appCtx.pipeline
        .redeploy(project.id, {
          noCache,
          strategy,
          healthCheckPath: healthCheckPath?.trim() || undefined,
          cmd,
          lockSessionId: toolSessionId,
        })
        .catch((err: unknown) => {
          if (err instanceof DeployLockedError) {
            log.warn({ err, projectId: project.id }, 'Redeploy skipped: project lock is held');
            return;
          }
          log.error({ err, projectId: project.id }, 'Redeploy failed');
        });

      return {
        status: 'redeploying',
        project: projectName,
        message: noCache
          ? 'Redeployment started (no_cache). Full rebuild may take 3-5+ minutes. Poll get_deploy_status to track progress.'
          : 'Redeployment started. Poll get_deploy_status to track progress.',
      };
    },
  },

  {
    name: 'update_project_config',
    riskLevel: 'medium',
    description:
      "Update a project's build configuration (dockerfile_path, docker_target, build_context). Use when the current config points to a wrong Dockerfile or build target. Changes take effect on next redeploy. Returns the updated config values.",
    mcpDescription:
      'Update project build config (dockerfile_path, docker_target, build_context). Takes effect on next redeploy.',
    inputSchema: updateProjectConfigSchema,
    execute: (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const updates: Record<string, string | null> = {};
      if (args['dockerfile_path'] !== undefined) {
        const val = (args['dockerfile_path'] as string).trim();
        if (val.startsWith('/') || val.includes('..')) {
          throw new Error('dockerfile_path must be a relative path within the repository');
        }
        updates.dockerfilePath = val || 'Dockerfile';
      }
      if (args['docker_target'] !== undefined) {
        const val = (args['docker_target'] as string).trim();
        updates.dockerTarget = val === '' ? null : val;
      }
      if (args['build_context'] !== undefined) {
        const val = (args['build_context'] as string).trim();
        if (val.startsWith('/') || val.includes('..')) {
          throw new Error('build_context must be a relative path within the repository');
        }
        updates.buildContext = val === '' ? null : val;
      }

      context.appCtx.db.updateProject(project.id, updates);

      const updated = context.appCtx.db.getProject(project.id);
      return {
        status: 'updated',
        project: projectName,
        config: {
          dockerfile_path: updated?.dockerfile_path,
          docker_target: updated?.docker_target,
          build_context: updated?.build_context,
        },
        _agent_guidance: {
          next_steps: ['Call redeploy_project to apply the new configuration.'],
        },
      };
    },
  },
  {
    name: 'archive_project',
    description:
      'Archive a project (soft delete). Stops and removes containers, frees port, but preserves all configuration, environment variables, and deployment history. Use unarchive_project to restore.',
    mcpDescription:
      'Archive a project to stop its containers and free resources while preserving all configuration and history.',
    inputSchema: archiveProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      if (project.status === 'building') {
        context.appCtx.docker.cancelBuild(project.id);
      }

      await context.appCtx.pipeline.archive(project.id);
      return {
        status: 'archived',
        project: project.name,
        _agent_guidance: {
          message:
            'Project archived successfully. All environment variables and history preserved.',
          next_steps: ['Use unarchive_project to restore this project when needed.'],
        },
      };
    },
    targets: ['agent', 'mcp'],
  },
  {
    name: 'unarchive_project',
    description:
      'Restore an archived project. Re-enables the project for deployment (assigns a new port). Does not automatically redeploy — use redeploy_project or execute_deploy_plan to start the container.',
    mcpDescription:
      'Restore an archived project to an active state with a new port assignment. After unarchiving, use redeploy_project to start the container.',
    inputSchema: unarchiveProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const allProjects = context.appCtx.db.listProjects(undefined, { includeArchived: true });
      const project = allProjects.find((p) => p.name === projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      await context.appCtx.pipeline.unarchive(project.id);
      const updated = context.appCtx.db.getProject(project.id);
      const newPort = updated?.assigned_port ?? 'unknown';
      return {
        status: 'unarchived',
        project: project.name,
        port: updated?.assigned_port,
        _agent_guidance: {
          message: `Project unarchived. Assigned new port ${String(newPort)}. Use redeploy_project to start the container.`,
          next_steps: [
            'Use redeploy_project to restart the container with existing configuration.',
          ],
        },
      };
    },
    targets: ['agent', 'mcp'],
  },
];
