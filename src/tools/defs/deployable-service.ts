import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  OpenLanderError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import { createModuleLogger } from '../../lib/logger.js';
import {
  buildDeployLockedResponse,
  buildPolicyRejectionResponse,
  tryAcquireDeployLockOrResponse,
  tryRejectIfNotMutable,
} from './helpers.js';
import type { ToolContext, ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-deployable-service');

const serviceTargetFields = {
  service_id: z.string().min(1).optional().describe('Deployable service id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Deployable service row name. If no service has that name, a project group name with exactly one deployable service is accepted as a convenience.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe('Optional project group name to scope service_name lookups'),
} as const;

const serviceTargetSchema = z
  .object(serviceTargetFields)
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

const deployServiceSchema = z
  .object({
    ...serviceTargetFields,
    no_cache: z.boolean().optional().describe('Force a fresh Docker build without cache.'),
    strategy: z
      .enum(['blue-green', 'force'])
      .optional()
      .describe('Deploy strategy (default: force)'),
    health_check_path: z.string().optional().describe('Health check endpoint path'),
    cmd: z.array(z.string()).optional().describe('Override container start command'),
  })
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

const restartServiceSchema = z
  .object({
    ...serviceTargetFields,
    no_cache: z.boolean().optional().describe('Force a fresh Docker build without cache.'),
  })
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

const updateServiceConfigSchema = z
  .object({
    ...serviceTargetFields,
    dockerfile_path: z.string().optional().describe('Dockerfile path relative to repository root'),
    docker_target: z.string().optional().describe('Docker build target'),
    build_context: z.string().optional().describe('Build context relative to repository root'),
  })
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

type AppCtx = ToolContext['appCtx'];
type ServiceRow = Awaited<ReturnType<AppCtx['db']['getService']>>;
type ProjectRow = Awaited<ReturnType<AppCtx['db']['getProject']>>;
type ResolvedServiceRow = NonNullable<ServiceRow>;
type ResolvedProjectRow = NonNullable<ProjectRow>;

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

async function resolveProjectScope(
  projectName: string,
  context: ToolContext,
): Promise<ResolvedProjectRow | undefined> {
  if (!projectName) return undefined;
  return (
    (await context.appCtx.db.getProject(projectName)) ??
    (await context.appCtx.db.getProjectByName(projectName))
  );
}

async function serviceSelectionCandidates(services: ResolvedServiceRow[], context: ToolContext) {
  return Promise.all(
    services.map(async (service) => {
      const project = await context.appCtx.db.getProject(service.project_id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        projectId: service.project_id,
        projectName: project?.name ?? service.project_id,
        kind: service.kind,
        source: service.source,
      };
    }),
  );
}

async function throwServiceSelectionRequired(
  serviceName: string,
  candidates: ResolvedServiceRow[],
  context: ToolContext,
): Promise<never> {
  throw new OpenLanderError(
    `Multiple deployable services named '${serviceName}' found. Specify project_name or service_id.`,
    'SERVICE_SELECTION_REQUIRED',
    400,
    {
      serviceName,
      candidates: await serviceSelectionCandidates(candidates, context),
    },
  );
}

async function resolveSingleDeployableProjectAlias(
  projectName: string,
  context: ToolContext,
): Promise<ResolvedServiceRow | undefined> {
  const project = await resolveProjectScope(projectName, context);
  if (!project) return undefined;

  const services = await context.appCtx.db.getDeployablesByGroup(project.id);
  const deployables = services.filter((item) => !isManagedService(item.kind));
  if (deployables.length > 1) {
    throw new OpenLanderError(
      `Project '${projectName}' has multiple deployable services. Specify service_id or the service row name.`,
      'SERVICE_SELECTION_REQUIRED',
      400,
      {
        projectId: project.id,
        projectName: project.name,
        candidates: await serviceSelectionCandidates(deployables, context),
      },
    );
  }
  return deployables[0];
}

async function resolveServiceByName(
  serviceName: string,
  projectName: string,
  context: ToolContext,
): Promise<ResolvedServiceRow> {
  const projectScope = await resolveProjectScope(projectName, context);
  if (projectName && !projectScope) {
    throw new ProjectNotFoundError(projectName);
  }

  const services = await context.appCtx.db.listServices();
  const namedServices = services.filter((item) => item.name === serviceName);
  const scopedServices = projectScope
    ? namedServices.filter((item) => item.project_id === projectScope.id)
    : namedServices;
  const deployableServices = scopedServices.filter((item) => !isManagedService(item.kind));

  if (deployableServices.length > 1) {
    await throwServiceSelectionRequired(serviceName, deployableServices, context);
  }

  const service = deployableServices[0] ?? scopedServices[0];
  if (!service && !projectName) {
    const projectAliasService = await resolveSingleDeployableProjectAlias(serviceName, context);
    if (projectAliasService) {
      return projectAliasService;
    }
  }
  if (!service) {
    throw new ServiceNotFoundError(projectName ? `${serviceName} in ${projectName}` : serviceName);
  }
  return service;
}

async function resolveDeployableService(
  args: Record<string, unknown>,
  context: ToolContext,
  operation: string,
): Promise<{
  service: NonNullable<ServiceRow>;
  project: NonNullable<ProjectRow>;
  runtimeProject: NonNullable<ProjectRow>;
}> {
  const serviceId = typeof args.service_id === 'string' ? args.service_id.trim() : '';
  const serviceName = typeof args.service_name === 'string' ? args.service_name.trim() : '';
  const projectName = typeof args.project_name === 'string' ? args.project_name.trim() : '';

  let service: ServiceRow | undefined;
  if (serviceId) {
    service = await context.appCtx.db.getService(serviceId);
  } else if (serviceName) {
    service = await resolveServiceByName(serviceName, projectName, context);
  }

  if (!service) {
    throw new ServiceNotFoundError(serviceId || serviceName || 'unknown');
  }
  if (isManagedService(service.kind)) {
    throw new ServiceOperationUnsupportedError(operation, service.kind);
  }

  const project = await context.appCtx.db.getProject(service.project_id);
  if (!project) {
    throw new ProjectNotFoundError(service.project_id);
  }

  if (projectName && projectName !== project.id && projectName !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectName}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await context.appCtx.db.getProject(runtimeProjectId)) ?? project;

  return { service, project, runtimeProject };
}

function serviceSummary(service: NonNullable<ServiceRow>, project: NonNullable<ProjectRow>) {
  return {
    id: service.id,
    name: service.name,
    projectId: project.id,
    projectName: project.name,
    kind: service.kind,
    source: service.source,
  };
}

export async function runDeployableServiceAction(
  args: Record<string, unknown>,
  context: ToolContext,
  action: 'redeploy_app' | 'restart_service',
) {
  const { service, project, runtimeProject } = await resolveDeployableService(
    args,
    context,
    action,
  );
  const noCache = (args.no_cache as boolean | undefined) === true;
  const strategy = args.strategy as 'blue-green' | 'force' | undefined;
  const healthCheckPath = args.health_check_path as string | undefined;
  const cmd = args.cmd as string[] | undefined;

  const groupPolicyRejection =
    runtimeProject.id === project.id ? undefined : await tryRejectIfNotMutable(project, context);
  if (groupPolicyRejection) {
    return groupPolicyRejection;
  }

  const policyRejection = await tryRejectIfNotMutable(runtimeProject, context);
  if (policyRejection) {
    return policyRejection;
  }

  const sessionId = `mcp-${action}-${nanoid(12)}`;
  const lockResult = await tryAcquireDeployLockOrResponse(runtimeProject.id, sessionId, context);
  if (lockResult) {
    return lockResult;
  }

  const releaseDbLock = () =>
    context.appCtx.db.releaseDeployLock(runtimeProject.id, sessionId).catch((err: unknown) => {
      log.warn(
        { err, projectId: runtimeProject.id, groupProjectId: project.id, serviceId: service.id },
        'Failed to release deploy lock',
      );
    });

  const execute = async () => {
    if (action === 'restart_service') {
      await context.appCtx.pipeline.stop(runtimeProject.id);
    }
    await context.appCtx.pipeline.redeploy(runtimeProject.id, {
      noCache,
      strategy,
      healthCheckPath: healthCheckPath?.trim() || undefined,
      cmd,
      lockSessionId: sessionId,
    });
  };

  void execute()
    .catch((err: unknown) => {
      if (err instanceof DeployLockedError) {
        log.warn(
          { err, projectId: runtimeProject.id, groupProjectId: project.id, serviceId: service.id },
          'Service deploy skipped: lock held',
        );
        return;
      }
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        log.warn(
          {
            err,
            projectId: runtimeProject.id,
            groupProjectId: project.id,
            serviceId: service.id,
            code: err.code,
          },
          'Service deploy rejected by mutation policy mid-flight',
        );
        return;
      }
      log.error(
        { err, projectId: runtimeProject.id, groupProjectId: project.id, serviceId: service.id },
        'Service deploy failed',
      );
    })
    .finally(releaseDbLock);

  return {
    status: action === 'restart_service' ? 'restarting' : 'deploying',
    service: serviceSummary(service, project),
    message: noCache
      ? 'Deployment started (no_cache). Poll get_deploy_status to track progress.'
      : 'Deployment started. Poll get_deploy_status to track progress.',
    diagnostic_call: {
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: service.id },
    },
    _agent_guidance: {
      next_steps: [
        'Poll openlander_deploy.get_deploy_status to track progress.',
        `If deployment fails or times out, call openlander_monitor.diagnose_service with service_id="${service.id}".`,
      ],
    },
  };
}

export const deployableServiceToolDefs: ToolDef[] = [
  {
    name: 'redeploy_app',
    riskLevel: 'medium',
    description:
      'Deploy or redeploy a deployable app/worker service. Provide service_id or service_name. Runs in background; poll get_deploy_status for progress.',
    mcpDescription:
      'Deploy/redeploy a deployable app/worker service. Provide service_id or service_name.',
    inputSchema: deployServiceSchema,
    execute: (args, context) => runDeployableServiceAction(args, context, 'redeploy_app'),
  },
  {
    name: 'restart_service',
    riskLevel: 'medium',
    description:
      'Restart a deployable app/worker service by stopping and redeploying it. Provide service_id or service_name.',
    mcpDescription: 'Restart a deployable app/worker service by stopping and redeploying it.',
    inputSchema: restartServiceSchema,
    execute: (args, context) => runDeployableServiceAction(args, context, 'restart_service'),
  },
  {
    name: 'rollback_service',
    riskLevel: 'high',
    description:
      'Rollback a deployable app/worker service to its previous Docker image. Provide service_id or service_name.',
    mcpDescription: 'Rollback a deployable app/worker service to its previous image.',
    inputSchema: serviceTargetSchema,
    execute: async (args, context) => {
      const { service, project, runtimeProject } = await resolveDeployableService(
        args,
        context,
        'rollback_service',
      );
      const sessionId = `mcp-rollback-service-${nanoid(12)}`;
      const groupPolicyRejection =
        runtimeProject.id === project.id
          ? undefined
          : await tryRejectIfNotMutable(project, context);
      if (groupPolicyRejection) {
        return groupPolicyRejection;
      }
      const policyRejection = await tryRejectIfNotMutable(runtimeProject, context);
      if (policyRejection) {
        return policyRejection;
      }
      const lockResult = await tryAcquireDeployLockOrResponse(
        runtimeProject.id,
        sessionId,
        context,
      );
      if (lockResult) {
        return lockResult;
      }
      const releaseDbLock = () =>
        context.appCtx.db.releaseDeployLock(runtimeProject.id, sessionId).catch((err: unknown) => {
          log.warn(
            {
              err,
              projectId: runtimeProject.id,
              groupProjectId: project.id,
              serviceId: service.id,
            },
            'Failed to release deploy lock',
          );
        });
      const memLockAcquired = context.appCtx.agentPool
        ? context.appCtx.agentPool.acquireProjectLock(runtimeProject.id, sessionId)
        : true;
      if (!memLockAcquired) {
        const lock = context.appCtx.agentPool?.getProjectLock(runtimeProject.id);
        await releaseDbLock();
        return buildDeployLockedResponse(
          new DeployLockedError(runtimeProject.id, lock?.sessionId ?? 'unknown'),
        );
      }
      try {
        const result = await context.appCtx.pipeline.rollback(
          runtimeProject.id,
          undefined,
          sessionId,
        );
        return { ...result, service: serviceSummary(service, project) };
      } catch (err) {
        if (err instanceof DeployLockedError) return buildDeployLockedResponse(err);
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return buildPolicyRejectionResponse(err, project.name);
        }
        throw err;
      } finally {
        context.appCtx.agentPool?.releaseProjectLock(runtimeProject.id, sessionId);
        await releaseDbLock();
      }
    },
  },
  {
    name: 'archive_service',
    riskLevel: 'high',
    description:
      'Archive a deployable app/worker service. Provide service_id or service_name. Stops runtime and preserves configuration/history.',
    mcpDescription:
      'Archive a deployable app/worker service while preserving configuration/history.',
    inputSchema: serviceTargetSchema,
    execute: async (args, context) => {
      const { service, project, runtimeProject } = await resolveDeployableService(
        args,
        context,
        'archive_service',
      );
      await context.appCtx.pipeline.archive(runtimeProject.id);
      return { status: 'archived', service: serviceSummary(service, project) };
    },
  },
  {
    name: 'unarchive_service',
    riskLevel: 'medium',
    description:
      'Restore an archived deployable app/worker service. Provide service_id or service_name. Does not deploy automatically.',
    mcpDescription:
      'Restore an archived deployable app/worker service. Call redeploy_app to run it.',
    inputSchema: serviceTargetSchema,
    execute: async (args, context) => {
      const { service, project, runtimeProject } = await resolveDeployableService(
        args,
        context,
        'unarchive_service',
      );
      await context.appCtx.pipeline.unarchive(runtimeProject.id);
      return { status: 'unarchived', service: serviceSummary(service, project) };
    },
  },
  {
    name: 'update_service_config',
    riskLevel: 'medium',
    description:
      'Update deployable service build config (dockerfile_path, docker_target, build_context). Takes effect on next redeploy_app.',
    mcpDescription: 'Update deployable service build config. Takes effect on next redeploy_app.',
    inputSchema: updateServiceConfigSchema,
    execute: async (args, context) => {
      const { service, project } = await resolveDeployableService(
        args,
        context,
        'update_service_config',
      );
      const updates: Record<string, string | null> = {};
      if (args.dockerfile_path !== undefined) {
        const val = (args.dockerfile_path as string).trim();
        if (val.startsWith('/') || val.includes('..')) {
          throw new OpenLanderError(
            'dockerfile_path must be a relative path within the repository',
            'INVALID_SERVICE_CONFIG',
            400,
          );
        }
        updates.dockerfilePath = val || 'Dockerfile';
      }
      if (args.docker_target !== undefined) {
        const val = (args.docker_target as string).trim();
        updates.dockerTarget = val === '' ? null : val;
      }
      if (args.build_context !== undefined) {
        const val = (args.build_context as string).trim();
        if (val.startsWith('/') || val.includes('..')) {
          throw new OpenLanderError(
            'build_context must be a relative path within the repository',
            'INVALID_SERVICE_CONFIG',
            400,
          );
        }
        updates.buildContext = val === '' ? null : val;
      }
      await context.appCtx.db.updateService(service.id, updates);
      const updated = await context.appCtx.db.getService(service.id);
      return {
        status: 'updated',
        service: serviceSummary(updated ?? service, project),
        config: {
          dockerfile_path: updated?.dockerfile_path ?? service.dockerfile_path,
          docker_target: updated?.docker_target ?? service.docker_target,
          build_context: updated?.build_context ?? service.build_context,
        },
        _agent_guidance: { next_steps: ['Call redeploy_app to apply the new configuration.'] },
      };
    },
  },
];
