import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import { assertDestructiveActionAllowed } from '../../security/operation-permissions.js';
import { DOCKER_LABELS } from '../../config/index.js';
import type { ProjectRow } from '../../db/index.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  OpenLanderError,
  ProjectArchivedError,
  ProjectRecoveringError,
  ServiceHasConsumersError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { LifecycleAction } from '../../pipeline/mutation-policy.js';
import { getRedeploySourceMissingError } from '../../pipeline/redeploy-source.js';
import { resolveComposeRedeployTarget } from '../../pipeline/compose-redeploy-target.js';
import {
  buildStatefulComposeApprovalPlan,
  statefulComposeApprovalDiff,
} from '../../mcp/stateful-compose-approval.js';
import { resolveEnvironmentByType } from './helpers/project-helpers.js';
import {
  assertProjectLifecycleMutableForRoute,
  assertProjectMutableForRoute,
  getServiceDeleteSlug,
  withProjectRuntimeLock,
} from './helpers/project-route-shared.js';

const log = createModuleLogger('api:service-runtime');

type ResolvedServiceForRequest = {
  project: ProjectRow;
  runtimeProject: ProjectRow;
  service: NonNullable<Awaited<ReturnType<AppContext['db']['getService']>>>;
};

async function resolveServiceForRequest(
  c: Context,
  ctx: AppContext,
): Promise<ResolvedServiceForRequest | Response> {
  const p = c.req.param('p') ?? '';
  const s = c.req.param('s') ?? '';
  const project = (await ctx.db.getProject(p)) ?? (await ctx.db.getProjectByName(p));
  if (!project) {
    return c.json({ error: 'NOT_FOUND', message: `Project not found: ${p}` }, 404);
  }

  const service =
    (await ctx.db.getService(s)) ??
    (await ctx.db.getService(projectIdToDeployableServiceId(s))) ??
    null;
  if (!service || service.project_id !== project.id) {
    return c.json({ error: 'NOT_FOUND', message: `Service not found: ${s}` }, 404);
  }
  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await ctx.db.getProject(runtimeProjectId)) ?? project;
  return { project, runtimeProject, service };
}

async function assertResolvedServiceMutable(
  ctx: AppContext,
  project: ProjectRow,
  runtimeProject: ProjectRow,
  service: ResolvedServiceForRequest['service'],
): Promise<void> {
  if (service.archived_at) {
    throw new ProjectArchivedError(runtimeProject.id);
  }
  if (runtimeProject.id !== project.id) {
    await assertProjectMutableForRoute(project, ctx);
  }
  await assertProjectMutableForRoute(runtimeProject, ctx);
}

async function assertResolvedServiceLifecycleMutable(
  ctx: AppContext,
  project: ProjectRow,
  runtimeProject: ProjectRow,
  service: ResolvedServiceForRequest['service'],
  action: LifecycleAction,
): Promise<void> {
  if (service.archived_at) {
    throw new ProjectArchivedError(runtimeProject.id);
  }
  if (runtimeProject.id !== project.id) {
    await assertProjectLifecycleMutableForRoute(project, action, ctx);
  }
  await assertProjectLifecycleMutableForRoute(runtimeProject, action, ctx);
}

function mutationPolicyResponse(c: Context, err: unknown): Response | null {
  if (
    err instanceof ProjectArchivedError ||
    err instanceof ProjectRecoveringError ||
    err instanceof CircuitBreakerOpenError
  ) {
    return c.json(err.toJSON(), 409);
  }
  return null;
}

export function createServiceRuntimeRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.delete('/projects/:p/services/:s/instance', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    if ((MANAGED_SERVICE_KINDS as readonly string[]).includes(service.kind)) {
      return c.json(
        {
          error: 'SERVICE_OPERATION_UNSUPPORTED',
          code: 'SERVICE_OPERATION_UNSUPPORTED',
          message: 'Managed infrastructure services use the managed-service removal flow.',
        },
        400,
      );
    }

    await assertDestructiveActionAllowed(ctx.db, {
      projectId: project.id,
      serviceId: service.id,
    });

    const body: { confirmation?: unknown; typedSlug?: unknown; deleteVolumes?: unknown } =
      await c.req
        .json<{ confirmation?: unknown; typedSlug?: unknown; deleteVolumes?: unknown }>()
        .catch(() => ({}));
    const typedSlug =
      typeof body.confirmation === 'string'
        ? body.confirmation.trim()
        : typeof body.typedSlug === 'string'
          ? body.typedSlug.trim()
          : '';
    const expectedSlug = getServiceDeleteSlug(project, service);
    const legacyRawSlug = `${project.name}/${service.name}`;
    if (typedSlug !== expectedSlug && typedSlug !== legacyRawSlug) {
      return c.json(
        {
          error: 'CONFIRMATION_REQUIRED',
          code: 'CONFIRMATION_REQUIRED',
          message: `Type '${expectedSlug}' to delete this service.`,
          details: { expectedSlug },
        },
        400,
      );
    }

    const providerConnections = await ctx.db.listServiceConsumersForProvider(service.id);
    const dependencyConsumers = await ctx.db.findProjectDependents(undefined, service.id);
    if (providerConnections.length > 0 || dependencyConsumers.length > 0) {
      const connectionConsumers = await Promise.all(
        providerConnections.map(async (connection) => {
          const consumer = await ctx.db.getService(connection.service_id_consumer);
          return {
            serviceId: connection.service_id_consumer,
            serviceName: consumer?.name ?? connection.service_id_consumer,
            projectId: consumer?.project_id ?? '',
          };
        }),
      );
      const dependencyServiceIds = new Set(
        dependencyConsumers
          .map((dependency) => dependency.source_service_id)
          .filter((serviceId): serviceId is string => Boolean(serviceId)),
      );
      const dependencyServiceConsumers = await Promise.all(
        Array.from(dependencyServiceIds).map(async (serviceId) => {
          const consumer = await ctx.db.getService(serviceId);
          return {
            serviceId,
            serviceName: consumer?.name ?? serviceId,
            projectId: consumer?.project_id ?? '',
          };
        }),
      );
      const consumers = [...connectionConsumers, ...dependencyServiceConsumers];
      const error = new ServiceHasConsumersError(service.id, service.name, consumers);
      return c.json(error.toJSON(), 409);
    }

    const result = await withProjectRuntimeLock(
      ctx,
      runtimeProject.id,
      'delete-service',
      async () => {
        ctx.coordinator.suppressProject(runtimeProject.id, 60_000);

        await ctx.cloudflare.deleteConnectedPublishReservation(service.project_id, service.id);

        const removedDomains: string[] = [];
        for (const mapping of await ctx.db.getDomainMappingsForService(service.id)) {
          try {
            await ctx.cloudflare.removeTunnelForService(service.id, mapping.domain);
          } catch (err) {
            log.warn(
              { err, serviceId: service.id, domain: mapping.domain },
              'Service delete domain disconnect failed; continuing with DB cleanup',
            );
            await ctx.db.deleteDomainMapping(mapping.id);
          }
          removedDomains.push(mapping.domain);
        }
        await ctx.db.deleteDomainMappingsByService(service.id);

        const environments = await ctx.db.getEnvironmentsByServiceId(service.id);
        const containerRefs = new Set<string>();
        const primaryContainerRef = service.container_id ?? service.container_name;
        if (primaryContainerRef) containerRefs.add(primaryContainerRef);
        for (const environment of environments) {
          if (environment.container_id) containerRefs.add(environment.container_id);
        }

        for (const containerRef of containerRefs) {
          try {
            await ctx.docker.stopContainer(containerRef);
          } catch (err) {
            log.debug({ err, serviceId: service.id, containerRef }, 'Service delete stop skipped');
          }
          await ctx.docker.removeContainer(containerRef);
        }
        const containerRemoved = containerRefs.size > 0;

        const deleteVolumes = body.deleteVolumes === true;
        const siblingDeployables = (await ctx.db.getDeployablesByGroup(project.id)).filter(
          (candidate) => candidate.id !== service.id,
        );
        const removedVolumes: string[] = [];
        let volumeDeleteSkippedReason: string | null = null;
        if (deleteVolumes) {
          if (siblingDeployables.length > 0) {
            volumeDeleteSkippedReason = 'PROJECT_HAS_SIBLING_SERVICES';
          } else {
            const volumes = await ctx.docker.listVolumes({
              label: [`${DOCKER_LABELS.MANAGED}=true`, `${DOCKER_LABELS.PROJECT}=${project.name}`],
            });
            for (const volume of volumes) {
              if (!volume.Name) continue;
              await ctx.docker.removeVolume(volume.Name);
              removedVolumes.push(volume.Name);
            }
          }
        }

        await ctx.db.deleteProjectDependenciesByService(service.id);
        await ctx.db.deleteService(service.id);
        if (runtimeProject.id !== project.id) {
          // Current invariant: attached deployables have a preserved 1:1
          // runtime project row with no remaining deployables under that row.
          // If a future model lets multiple services share a runtime project,
          // preserve the row until the last runtime-scoped service is gone.
          const remainingRuntimeDeployables = await ctx.db.getDeployablesByGroup(runtimeProject.id);
          if (remainingRuntimeDeployables.length === 0) {
            await ctx.docker.removeProjectNetwork(runtimeProject.name);
            await ctx.db.deleteProject(runtimeProject.id);
          }
        }

        return {
          status: 'deleted',
          project: project.name,
          service: service.name,
          serviceId: service.id,
          containerRemoved,
          removedDomains,
          volumes: {
            deleted: removedVolumes,
            preserved: !deleteVolumes || volumeDeleteSkippedReason !== null,
            skippedReason: volumeDeleteSkippedReason,
          },
        };
      },
    );
    if (result instanceof DeployLockedError) return c.json(result.toJSON(), 409);
    return c.json(result);
  });

  api.post('/projects/:p/services/:s/start', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    try {
      await assertResolvedServiceLifecycleMutable(ctx, project, runtimeProject, service, 'start');
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const containerId = service.container_id ?? runtimeProject.container_id;
    if (!containerId) {
      return c.json({ error: 'No container to start. Redeploy instead.' }, 400);
    }
    await ctx.pipeline.start(runtimeProject.id);
    return c.json({ status: 'started', project: project.name, service: service.name });
  });

  api.post('/projects/:p/services/:s/stop', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    try {
      await assertResolvedServiceLifecycleMutable(ctx, project, runtimeProject, service, 'stop');
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const lockSessionId = `stop-${runtimeProject.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(runtimeProject.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(runtimeProject.id);
      return c.json(
        new DeployLockedError(runtimeProject.id, lock?.sessionId ?? 'unknown').toJSON(),
        409,
      );
    }
    try {
      ctx.coordinator.suppressProject(runtimeProject.id, 60_000);
      await ctx.pipeline.stop(runtimeProject.id);
      return c.json({ status: 'stopped', project: project.name, service: service.name });
    } finally {
      ctx.agentPool?.releaseProjectLock(runtimeProject.id, lockSessionId);
    }
  });

  api.post('/projects/:p/services/:s/restart', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    try {
      await assertResolvedServiceLifecycleMutable(ctx, project, runtimeProject, service, 'stop');
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const lockSessionId = `restart-${runtimeProject.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(runtimeProject.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(runtimeProject.id);
      return c.json(
        new DeployLockedError(runtimeProject.id, lock?.sessionId ?? 'unknown').toJSON(),
        409,
      );
    }
    try {
      const result = await ctx.pipeline.restartServiceRuntime(service.id);
      return c.json({
        status: result.status,
        project: project.name,
        service: service.name,
        serviceId: service.id,
        containerId: result.containerId,
      });
    } finally {
      ctx.agentPool?.releaseProjectLock(runtimeProject.id, lockSessionId);
    }
  });

  api.post('/projects/:p/services/:s/deploy', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    const redeployTarget = await resolveComposeRedeployTarget(ctx.db, service);
    const deploymentService = redeployTarget.service;
    const deploymentRuntimeProjectId = deployableServiceIdToProjectId(deploymentService.id);
    const deploymentRuntimeProject =
      (await ctx.db.getProject(deploymentRuntimeProjectId)) ?? project;
    try {
      await assertResolvedServiceMutable(ctx, project, runtimeProject, service);
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const strategy = (c.req.query('strategy') ?? 'force') as 'blue-green' | 'force';
    const body = await c.req
      .json<{
        env_vars?: Record<string, string>;
        no_cache?: boolean;
        health_check_path?: string;
      }>()
      .catch(() => ({ env_vars: undefined, no_cache: undefined, health_check_path: undefined }));
    const sourceMissingError = getRedeploySourceMissingError(deploymentService);
    if (sourceMissingError) {
      return c.json({ success: false, ...sourceMissingError.toJSON() }, 400);
    }
    const requestEnvVars: Record<string, string> = {};
    if (body.env_vars && typeof body.env_vars === 'object') {
      for (const [key, value] of Object.entries(body.env_vars)) {
        const trimmed = value.trim();
        if (trimmed) requestEnvVars[key] = trimmed;
      }
    }
    if (
      deploymentService.kind === 'compose' &&
      typeof ctx.pipeline.prepareStatefulComposeUpdate === 'function'
    ) {
      const approval = await ctx.pipeline.prepareStatefulComposeUpdate(deploymentService.id, {
        envVars: requestEnvVars,
      });
      if (approval) {
        if (Object.keys(requestEnvVars).length > 0) {
          await ctx.env.setBulkForService(
            deploymentRuntimeProject.id,
            deploymentService.id,
            requestEnvVars,
          );
        }
        const plan = buildStatefulComposeApprovalPlan({
          approval,
          noCache: body.no_cache === true,
        });
        const actionRunId = await ctx.db.createPendingMcpApproval({
          projectId: approval.projectId,
          toolName: 'update_app',
          plan: JSON.stringify(plan),
        });
        return c.json(
          {
            success: false,
            status: 'pending_approval',
            action_run_id: actionRunId,
            project_id: approval.projectId,
            service_id: approval.serviceId,
            diff: statefulComposeApprovalDiff(approval),
            backup_required: true,
            data_effect:
              'Affected named volumes are backed up and retained. Replaced containers are preserved for rollback; removed resources are archived.',
          },
          202,
        );
      }
    }
    if (strategy === 'blue-green') {
      const eligibility = await ctx.pipeline.getBlueGreenEligibility(deploymentRuntimeProject.id, {
        healthCheckPath: body.health_check_path,
      });
      if (!eligibility.supported) {
        return c.json(
          {
            success: false,
            status: 'blocked',
            code: eligibility.code,
            strategy: 'blue-green',
            reasons: eligibility.reasons,
            guidance:
              'Make the service eligible for blue-green first. Use strategy=force only after the user explicitly accepts downtime.',
          },
          409,
        );
      }
    }
    if (Object.keys(requestEnvVars).length > 0) {
      await ctx.env.setBulkForService(runtimeProject.id, service.id, requestEnvVars);
    }
    const lockSessionId = `redeploy-${deploymentRuntimeProject.id}-${Date.now().toString(36)}`;
    if (
      ctx.agentPool &&
      !ctx.agentPool.acquireProjectLock(deploymentRuntimeProject.id, lockSessionId)
    ) {
      const lock = ctx.agentPool.getProjectLock(deploymentRuntimeProject.id);
      return c.json(
        new DeployLockedError(deploymentRuntimeProject.id, lock?.sessionId ?? 'unknown').toJSON(),
        409,
      );
    }
    const runRedeploy = async () => {
      ctx.coordinator.suppressProject(deploymentRuntimeProject.id, 120_000);
      if (strategy !== 'blue-green') {
        await ctx.db.updateProject(deploymentRuntimeProject.id, { status: 'building' });
      }
      return ctx.pipeline.redeployService(service.id, {
        noCache: body.no_cache,
        strategy,
        healthCheckPath: body.health_check_path,
      });
    };

    if (c.req.query('async') === 'true') {
      void (async () => {
        try {
          await runRedeploy();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(
            { err, projectId: deploymentRuntimeProject.id, serviceId: service.id },
            'Async service redeploy failed',
          );
          await ctx.db
            .updateProject(deploymentRuntimeProject.id, { status: 'error' })
            .catch((updateErr: unknown) => {
              log.warn(
                { err: updateErr, projectId: deploymentRuntimeProject.id },
                'Failed to mark async redeploy project as error',
              );
            });
          await ctx.db
            .createDeployLog({
              id: `deploy-${Date.now().toString(36)}`,
              projectId: deploymentRuntimeProject.id,
              status: 'failed',
              trigger: 'api',
              buildLog: `[error] ${errMsg}`,
            })
            .catch((logErr: unknown) => {
              log.warn(
                { err: logErr, projectId: deploymentRuntimeProject.id },
                'Failed to persist async redeploy failure log',
              );
            });
        } finally {
          ctx.agentPool?.releaseProjectLock(deploymentRuntimeProject.id, lockSessionId);
        }
      })();

      return c.json(
        {
          success: true,
          projectId: project.id,
          serviceId: service.id,
          deploymentId: service.id,
          status: 'building',
          statusUrl: `/api/projects/${deploymentRuntimeProject.id}`,
          logUrl: `/api/deployments/${service.id}/log/stream`,
        },
        202,
      );
    }

    try {
      const result = await runRedeploy();
      return c.json(
        { ...result, projectId: project.id, serviceId: service.id },
        result.success ? 200 : 500,
      );
    } catch (err) {
      if (err instanceof DeployLockedError) return c.json(err.toJSON(), 409);
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      if (err instanceof OpenLanderError) return c.json(err.toJSON(), err.statusCode as 400);
      await ctx.db.updateProject(deploymentRuntimeProject.id, { status: 'error' });
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    } finally {
      ctx.agentPool?.releaseProjectLock(deploymentRuntimeProject.id, lockSessionId);
    }
  });

  api.post('/projects/:p/services/:s/rollback', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    try {
      await assertResolvedServiceMutable(ctx, project, runtimeProject, service);
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const environmentResolution = await resolveEnvironmentByType(c, ctx, runtimeProject);
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;
    const lockSessionId = `rollback-${runtimeProject.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(runtimeProject.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(runtimeProject.id);
      return c.json(
        new DeployLockedError(runtimeProject.id, lock?.sessionId ?? 'unknown').toJSON(),
        409,
      );
    }
    try {
      ctx.coordinator.suppressProject(runtimeProject.id, 120_000);
      const result = await ctx.pipeline.rollback(
        runtimeProject.id,
        environmentRow?.id,
        lockSessionId,
      );
      return c.json(
        { ...result, projectId: project.id, serviceId: service.id },
        result.success ? 200 : 500,
      );
    } catch (err) {
      if (err instanceof DeployLockedError) return c.json(err.toJSON(), 409);
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      if (err instanceof OpenLanderError) return c.json(err.toJSON(), err.statusCode as 400);
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    } finally {
      ctx.agentPool?.releaseProjectLock(runtimeProject.id, lockSessionId);
    }
  });

  api.post('/projects/:p/services/:s/archive', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    try {
      await assertResolvedServiceLifecycleMutable(ctx, project, runtimeProject, service, 'archive');
    } catch (err) {
      const response = mutationPolicyResponse(c, err);
      if (response) return response;
      throw err;
    }
    const lockSessionId = `archive-${runtimeProject.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(runtimeProject.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(runtimeProject.id);
      return c.json(
        new DeployLockedError(runtimeProject.id, lock?.sessionId ?? 'unknown').toJSON(),
        409,
      );
    }
    try {
      ctx.coordinator.suppressProject(runtimeProject.id, 60_000);
      await ctx.pipeline.archive(runtimeProject.id);
      const updated = await ctx.db.getProject(runtimeProject.id);
      return c.json({ project: project.name, service: service.name, runtimeProject: updated });
    } finally {
      ctx.agentPool?.releaseProjectLock(runtimeProject.id, lockSessionId);
    }
  });

  api.post('/projects/:p/services/:s/unarchive', async (c) => {
    const resolved = await resolveServiceForRequest(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, runtimeProject, service } = resolved;
    await ctx.pipeline.unarchive(runtimeProject.id);
    const updated = await ctx.db.getProject(runtimeProject.id);
    return c.json({ project: project.name, service: service.name, runtimeProject: updated });
  });

  return api;
}
