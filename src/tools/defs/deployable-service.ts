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
import { getRedeploySourceMissingError } from '../../pipeline/redeploy-source.js';
import {
  buildDeployLockedResponse,
  buildPolicyRejectionResponse,
  deployTriggerForToolContext,
  tryAcquireDeployLockOrResponse,
  tryRejectIfNotMutable,
} from './helpers.js';
import type { ToolContext, ToolDef } from './types.js';

const log = createModuleLogger('tools-defs-deployable-service');

const serviceTargetFields = {
  service_id: z.string().min(1).optional().describe('Application/Compose service_id'),
  service_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Application/Compose name. If no workload has that name, a Project name with exactly one workload is accepted as a convenience.',
    ),
  project_name: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Project name to scope service_name lookups'),
} as const;

const serviceTargetSchema = z
  .object(serviceTargetFields)
  .refine((value) => Boolean(value.service_id || value.service_name), {
    message: 'service_id or service_name is required',
  });

const archivedServicesSchema = z
  .object({
    project_id: z.string().min(1).optional().describe('Project id'),
    project_name: z.string().min(1).optional().describe('Project name'),
  })
  .refine((value) => Boolean(value.project_id || value.project_name), {
    message: 'project_id or project_name is required',
  });

const deployServiceSchema = z
  .object({
    ...serviceTargetFields,
    no_cache: z
      .boolean()
      .optional()
      .describe('Force a fresh Docker build when Docker cache may hide dependency changes.'),
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
    no_cache: z
      .boolean()
      .optional()
      .describe('Force a fresh Docker build when Docker cache may hide dependency changes.'),
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

async function resolveProjectGroupTarget(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ResolvedProjectRow> {
  const projectId = typeof args.project_id === 'string' ? args.project_id.trim() : '';
  const projectName = typeof args.project_name === 'string' ? args.project_name.trim() : '';
  const project = projectId
    ? await context.appCtx.db.getProject(projectId)
    : await resolveProjectScope(projectName, context);

  if (!project) {
    throw new ProjectNotFoundError(projectId || projectName || 'unknown');
  }
  return project;
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
    `Multiple Applications/Compose workloads named '${serviceName}' found. Specify project_name or service_id.`,
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
      `Project '${projectName}' has multiple Applications/Compose workloads. Specify service_id or the workload name.`,
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

function archivedServiceSummary(
  service: NonNullable<ServiceRow>,
  project: NonNullable<ProjectRow>,
) {
  const displayName = deployableServiceIdToProjectId(service.name);
  const typedConfirmation = `${project.name}/${displayName}`;

  return {
    ...serviceSummary(service, project),
    status: service.status,
    archived_at: service.archived_at,
    available_actions: {
      restore: {
        kind: 'mcp_approval',
        tool: 'openlander_service',
        action: 'unarchive_service',
        approval_required: true,
        params: { service_id: service.id },
      },
      permanent_delete: {
        kind: 'web_ui_only',
        surface: 'project_settings_danger',
        path: 'Project Settings > Danger > Archived services',
        requires_human: true,
        reason: 'hard_delete_not_exposed_to_mcp',
        typed_confirmation: typedConfirmation,
      },
    },
  };
}

function archiveLifecycleGuidance(serviceId: string) {
  return {
    message:
      'Service archived. Archive is reversible cleanup, not permanent deletion: OpenLander stops/removes runtime containers, hides the service from default active lists, and preserves configuration/history.',
    next_steps: [
      `Use list_archived_services with this project to inspect archived cleanup targets, including service_id="${serviceId}".`,
      `Use unarchive_service with service_id="${serviceId}" if the service should be restored later.`,
      'Permanent deletion is Web UI-only: open the project Settings > Danger > Archived services and use the typed-confirm delete flow.',
    ],
  };
}

function unarchiveLifecycleGuidance(serviceId: string) {
  return {
    message:
      'Service restored to the active lifecycle path. No container was started automatically.',
    next_steps: [
      `Call redeploy_app with service_id="${serviceId}" if this service should run again.`,
      `Call openlander_monitor.diagnose_service with service_id="${serviceId}" after redeploying to verify runtime health.`,
    ],
  };
}

function buildArchivedServiceRejection(
  runtimeProject: ResolvedProjectRow,
  project: ResolvedProjectRow,
) {
  return buildPolicyRejectionResponse(new ProjectArchivedError(runtimeProject.id), project.name);
}

function parseInternalRedeployEnvVars(args: Record<string, unknown>): Record<string, string> {
  const value = args['env_vars'];
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new OpenLanderError(
      'env_vars must be an object when redeploying an existing app',
      'BAD_REQUEST',
      400,
    );
  }

  const vars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') {
      throw new OpenLanderError('env_vars values must be strings', 'BAD_REQUEST', 400, { key });
    }
    vars[key] = raw;
  }
  return vars;
}

function rollbackServiceGuidance(result: { success?: unknown }, serviceId: string) {
  const sharedLimit =
    'Rollback only switches the Application/Compose workload back to the stored previous Docker image. It does not restore databases, volumes, environment variables, secrets, or configuration.';
  if (result.success === true) {
    return {
      message: `${sharedLimit} Verify the service after rollback before reporting recovery.`,
      next_steps: [
        `Call openlander_monitor.diagnose_service with service_id="${serviceId}" to confirm the rollback is healthy.`,
        'If data/config drift caused the incident, inspect env vars, Database/Cache/Storage resources, and volumes separately.',
      ],
    };
  }

  return {
    message: `${sharedLimit} A rollback requires a stored previous image tag that still exists locally or can be pulled.`,
    next_steps: [
      `Call openlander_monitor.diagnose_service with service_id="${serviceId}" to inspect the current failure.`,
      'If no previous image is available, fix the source/configuration issue and call redeploy_app instead.',
    ],
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
  const envVars = parseInternalRedeployEnvVars(args);

  if (service.archived_at) {
    return buildArchivedServiceRejection(runtimeProject, project);
  }

  const groupPolicyRejection =
    runtimeProject.id === project.id ? undefined : await tryRejectIfNotMutable(project, context);
  if (groupPolicyRejection) {
    return groupPolicyRejection;
  }

  const policyRejection = await tryRejectIfNotMutable(runtimeProject, context);
  if (policyRejection) {
    return policyRejection;
  }

  const sourceMissingError = getRedeploySourceMissingError(service);
  if (sourceMissingError) {
    return {
      status: 'blocked',
      ...sourceMissingError.toJSON(),
      service: serviceSummary(service, project),
      _agent_guidance: {
        message:
          'This service has no reproducible deploy source, so redeploy/restart was not started and the existing container was left untouched.',
        next_steps: [
          'Use the web UI to inspect the live container before making changes.',
          'Create a new Application from GitHub or an image if you need a reproducible redeploy path.',
        ],
      },
    };
  }

  if (action === 'redeploy_app' && strategy === 'blue-green') {
    const eligibility = await context.appCtx.pipeline.getBlueGreenEligibility(runtimeProject.id, {
      healthCheckPath: healthCheckPath?.trim() || undefined,
    });
    if (!eligibility.supported) {
      return {
        status: 'blocked',
        code: eligibility.code,
        strategy: 'blue-green',
        service: serviceSummary(service, project),
        reasons: eligibility.reasons,
        fallback_call: {
          tool: 'openlander_service',
          action: 'redeploy_app',
          params: { service_id: service.id, strategy: 'force' },
        },
        _agent_guidance: {
          message:
            'Blue-green is only available for eligible git/image services behind managed OpenLander Traefik routes. No force deploy was started.',
          next_steps: [
            'If downtime is acceptable, call redeploy_app again with strategy="force".',
            'If zero-downtime is required, add a health check and use an OpenLander domain route before retrying blue-green.',
          ],
        },
      };
    }
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

  const envKeys = Object.keys(envVars);
  if (envKeys.length > 0) {
    const changes = await context.appCtx.env.setBulkForServiceDetailed(
      runtimeProject.id,
      service.id,
      envVars,
    );
    const mismatches = await context.appCtx.env.verifyRoundTripForService(
      runtimeProject.id,
      service.id,
      envVars,
    );

    if (mismatches.length > 0) {
      await releaseDbLock();
      return {
        status: 'error',
        error: 'ENV_ROUNDTRIP_FAILED',
        service: serviceSummary(service, project),
        keys: envKeys,
        mismatches,
        _agent_guidance: {
          next_steps: [
            'Do not redeploy yet. Re-run set_env_vars for the mismatched keys or inspect env storage.',
          ],
        },
      };
    }

    log.info(
      {
        projectId: runtimeProject.id,
        serviceId: service.id,
        keys: envKeys,
        changed: changes.filter((change) => change.op !== 'noop').length,
      },
      'Applied env_vars before service redeploy',
    );
  }

  const execute = async () => {
    await context.appCtx.pipeline.redeployService(service.id, {
      noCache,
      strategy,
      healthCheckPath: healthCheckPath?.trim() || undefined,
      cmd,
      lockSessionId: sessionId,
      trigger: deployTriggerForToolContext(context),
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
    status_call: {
      tool: 'openlander_deploy',
      action: 'get_deploy_status',
      params: { service_id: service.id },
    },
    _agent_guidance: {
      next_steps: [
        `Poll openlander_deploy.get_deploy_status with service_id="${service.id}" to track this deploy.`,
        `If deployment fails or times out, call openlander_monitor.diagnose_service with service_id="${service.id}".`,
      ],
    },
  };
}

export const deployableServiceToolDefs: ToolDef[] = [
  {
    name: 'list_archived_services',
    riskLevel: 'low',
    description:
      'List archived Applications/workers in a Project. Use this after archive_service/archive_project or when the user asks what can be restored or permanently deleted.',
    mcpDescription:
      'List archived Applications/workers for a Project. Archived means reversible cleanup, not permanent deletion.',
    inputSchema: archivedServicesSchema,
    execute: async (args, context) => {
      const project = await resolveProjectGroupTarget(args, context);
      const services = await context.appCtx.db.getDeployablesByGroup(project.id);
      const archivedServices = services
        .filter((service) => !isManagedService(service.kind))
        .filter((service) => service.archived_at);

      return {
        status: 'ok',
        project: { id: project.id, name: project.name },
        count: archivedServices.length,
        services: archivedServices.map((service) => archivedServiceSummary(service, project)),
        _agent_guidance: {
          message:
            archivedServices.length > 0
              ? 'These Applications are archived. They are hidden from default active lists but are not permanently deleted.'
              : 'No archived Applications were found for this Project.',
          next_steps:
            archivedServices.length > 0
              ? [
                  'Use unarchive_service with service_id to restore a service. Restoring does not redeploy automatically.',
                  'For permanent deletion, ask the user to use the Web UI service Danger zone; MCP hard delete remains blocked.',
                ]
              : [
                  'Use list_projects for active Projects and Application service_id values.',
                  'If a service was meant to be cleaned up, archive_service enters the human approval queue.',
                ],
        },
      };
    },
  },
  {
    name: 'redeploy_app',
    riskLevel: 'medium',
    description:
      'Deploy or redeploy an Application/worker. Provide service_id or service_name. Runs in background; poll get_deploy_status for progress.',
    mcpDescription: 'Deploy/redeploy an Application/worker. Provide service_id or service_name.',
    inputSchema: deployServiceSchema,
    execute: (args, context) => runDeployableServiceAction(args, context, 'redeploy_app'),
  },
  {
    name: 'restart_service',
    riskLevel: 'medium',
    description:
      'Restart an Application/worker by stopping and redeploying it. Provide service_id or service_name.',
    mcpDescription: 'Restart an Application/worker by stopping and redeploying it.',
    inputSchema: restartServiceSchema,
    execute: (args, context) => runDeployableServiceAction(args, context, 'restart_service'),
  },
  {
    name: 'rollback_service',
    riskLevel: 'high',
    description:
      'Rollback an Application/worker to its stored previous Docker image. This does not restore databases, volumes, environment variables, secrets, or config. Provide service_id or service_name.',
    mcpDescription:
      'Rollback an Application/worker to its stored previous Docker image only. Does not restore DB/env/volumes/config.',
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
      if (service.archived_at) {
        return buildArchivedServiceRejection(runtimeProject, project);
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
          deployTriggerForToolContext(context),
        );
        return {
          ...result,
          service: serviceSummary(service, project),
          _agent_guidance: rollbackServiceGuidance(result, service.id),
        };
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
      'Archive an Application/worker. Provide service_id or service_name. Stops runtime and preserves configuration/history.',
    mcpDescription:
      'Request human approval to archive an Application/worker while preserving configuration/history.',
    inputSchema: serviceTargetSchema,
    execute: async (args, context) => {
      const { service, project, runtimeProject } = await resolveDeployableService(
        args,
        context,
        'archive_service',
      );
      if (service.archived_at) {
        return buildArchivedServiceRejection(runtimeProject, project);
      }
      await context.appCtx.pipeline.archive(runtimeProject.id);
      return {
        status: 'archived',
        project_id: project.id,
        service_id: service.id,
        service: serviceSummary(service, project),
        _agent_guidance: archiveLifecycleGuidance(service.id),
      };
    },
  },
  {
    name: 'unarchive_service',
    riskLevel: 'medium',
    description:
      'Restore an archived Application/worker. Provide service_id or service_name. Does not deploy automatically.',
    mcpDescription: 'Restore an archived Application/worker. Call redeploy_app to run it.',
    inputSchema: serviceTargetSchema,
    execute: async (args, context) => {
      const { service, project, runtimeProject } = await resolveDeployableService(
        args,
        context,
        'unarchive_service',
      );
      await context.appCtx.pipeline.unarchive(runtimeProject.id);
      return {
        status: 'unarchived',
        project_id: project.id,
        service_id: service.id,
        service: serviceSummary(service, project),
        _agent_guidance: unarchiveLifecycleGuidance(service.id),
      };
    },
  },
  {
    name: 'update_service_config',
    riskLevel: 'medium',
    description:
      'Update Application/Compose build config (dockerfile_path, docker_target, build_context). Takes effect on next redeploy_app.',
    mcpDescription: 'Update Application/Compose build config. Takes effect on next redeploy_app.',
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
