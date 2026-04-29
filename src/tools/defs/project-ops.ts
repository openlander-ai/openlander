import { nanoid } from 'nanoid';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import { tryAcquireDeployLockOrResponse, tryRejectIfNotMutable } from './helpers.js';
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

async function reconcileRunningProjects(appCtx: Parameters<ToolDef['execute']>[1]['appCtx']) {
  const projects = appCtx.db.listProjects();

  for (const project of projects) {
    // PR 4.5: canonical-first read of runtime fields with `??` fallback to
    // legacy `projects` columns through migration 0012.
    const deployable = appCtx.db.getDeployableForProject(project.id);
    const status = deployable?.status ?? project.status;
    const containerId = deployable?.container_id ?? project.container_id;

    if (status !== 'running' || !containerId) {
      continue;
    }

    try {
      const info = await appCtx.docker.inspectContainer(containerId);
      const nextStatus = info.State.Running ? 'running' : 'stopped';

      if (nextStatus !== status || info.Id !== containerId) {
        appCtx.db.updateProject(project.id, { status: nextStatus, containerId: info.Id });
      }
    } catch (err) {
      log.debug({ err, projectId: project.id, containerId }, 'Failed to inspect project container');
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

      // PR 4.5: canonical-first status read.
      const deployable = context.appCtx.db.getDeployableForProject(project.id);
      const projectStatus = deployable?.status ?? project.status;
      if (projectStatus === 'building') {
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
      // PR 4.5: batch-resolve deployables once so per-project mapping
      // reads canonical-first with `??` fallback to the legacy `projects`
      // columns through migration 0012.
      const deployables = new Map<
        string,
        ReturnType<typeof context.appCtx.db.getDeployableForProject>
      >();
      for (const p of projects) {
        deployables.set(p.id, context.appCtx.db.getDeployableForProject(p.id));
      }

      if (context.target === 'mcp') {
        return {
          count: projects.length,
          projects: projects.map((project) => {
            const deployable = deployables.get(project.id);
            const status = deployable?.status ?? project.status;
            const port = deployable?.assigned_port ?? project.assigned_port;
            const containerId = deployable?.container_id ?? project.container_id;
            const publicUrl = deployable?.public_url ?? project.public_url;
            return {
              id: project.id,
              name: project.name,
              status,
              visibility: project.visibility,
              repoUrl: project.repo_url,
              branch: project.branch,
              port,
              containerName: containerId ? projectContainerName(project.name) : null,
              network: SHARED_NETWORK_NAME,
              url: port ? getProjectUrl(project.name) : null,
              urls: port ? getProjectUrls(project.name) : [],
              publicUrl,
              createdAt: project.created_at,
              updatedAt: project.updated_at,
            };
          }),
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
        projects: projects.map((project) => {
          const deployable = deployables.get(project.id);
          const status = deployable?.status ?? project.status;
          const port = deployable?.assigned_port ?? project.assigned_port;
          const containerId = deployable?.container_id ?? project.container_id;
          const publicUrl = deployable?.public_url ?? project.public_url;
          return {
            name: project.name,
            status,
            visibility: project.visibility,
            port,
            containerName: containerId ? projectContainerName(project.name) : null,
            url: port ? getProjectUrl(project.name) : null,
            publicUrl,
            repoUrl: project.repo_url,
          };
        }),
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
      // Fire-and-forget pre-check: surface archived/recovering/circuit-open
      // immediately instead of stopping the project + returning a fake
      // "restarting" success while the pipeline boundary silently rejects.
      const policyRejection = tryRejectIfNotMutable(project, context);
      if (policyRejection) {
        return policyRejection;
      }

      // 1.0 GA: acquire BEFORE stop so a lock-rejected restart does not leave
      // the project in `stopped` state. Lock failure now keeps the container
      // running and surfaces a typed `PROJECT_BUSY` response. Same lock then
      // guards stop + redeploy together.
      const restartSessionId = `mcp-restart-${nanoid(12)}`;
      const memLockAcquired = context.appCtx.agentPool
        ? context.appCtx.agentPool.acquireProjectLock(project.id, restartSessionId)
        : true;
      if (!memLockAcquired) {
        const lock = context.appCtx.agentPool?.getProjectLock(project.id);
        log.warn(
          { projectId: project.id, lockedBy: lock?.sessionId },
          'Restart skipped: project lock already held',
        );
        return {
          status: 'rejected',
          project: projectName,
          reason: 'PROJECT_BUSY',
          message: 'Another deploy is already in progress for this project.',
        };
      }

      // Stop is now inside the same lock as the redeploy below. Run it
      // synchronously (and release the lock if it fails) so we don't leave
      // the project in the awkward "stopped, lock held, no redeploy" state.
      try {
        await context.appCtx.pipeline.stop(project.id);
      } catch (err) {
        context.appCtx.agentPool?.releaseProjectLock(project.id, restartSessionId);
        throw err;
      }

      void context.appCtx.pipeline
        .redeploy(project.id, { noCache })
        .catch((err: unknown) => {
          if (
            err instanceof ProjectArchivedError ||
            err instanceof ProjectRecoveringError ||
            err instanceof CircuitBreakerOpenError ||
            err instanceof DeployLockedError
          ) {
            log.warn(
              { err, projectId: project.id, code: err.code },
              'Restart redeploy rejected mid-flight',
            );
            return;
          }
          log.error({ err, projectId: project.id }, 'Restart redeploy failed');
        })
        .finally(() => {
          context.appCtx.agentPool?.releaseProjectLock(project.id, restartSessionId);
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
      // Fire-and-forget pre-check: surface archived/recovering/circuit-open
      // immediately instead of returning a fake "redeploying" success while
      // the pipeline boundary silently rejects in the background.
      const policyRejection = tryRejectIfNotMutable(project, context);
      if (policyRejection) {
        return policyRejection;
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
          if (
            err instanceof ProjectArchivedError ||
            err instanceof ProjectRecoveringError ||
            err instanceof CircuitBreakerOpenError
          ) {
            log.warn(
              { err, projectId: project.id, code: err.code },
              'Redeploy rejected by mutation policy mid-flight',
            );
            return;
          }
          log.error({ err, projectId: project.id }, 'Redeploy failed');
        })
        .finally(() => {
          context.appCtx.db.releaseDeployLock(project.id, toolSessionId);
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

      // PR 4.5: canonical-first status read.
      const deployable = context.appCtx.db.getDeployableForProject(project.id);
      const projectStatus = deployable?.status ?? project.status;
      if (projectStatus === 'building') {
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
