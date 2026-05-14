import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { DeployLogRow, ProjectRow, ServiceRow } from '../../db/index.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import { extractFailureSummary, normalizeTimestamp } from './helpers/project-route-shared.js';
import { resolveDeployableServiceForRoute } from './helpers/deployable-service-route-shared.js';

function parseLimit(value: string | undefined, fallback: number): number {
  return parseInt(value ?? String(fallback), 10);
}

function mapDeployLogSummary(log: DeployLogRow) {
  return {
    id: log.id,
    status: log.status,
    trigger: log.trigger,
    triggerDetail: log.trigger_detail,
    commitSha: log.commit_sha,
    commitMessage: log.commit_message ?? null,
    durationMs: log.duration_ms,
    createdAt: normalizeTimestamp(log.created_at),
    failureSummary: log.status === 'failed' ? extractFailureSummary(log.build_log) : null,
  };
}

type DeployLogSummary = ReturnType<typeof mapDeployLogSummary>;

function mapInFlightDeploySummary(service: ServiceRow) {
  return {
    id: service.id,
    status: 'building' as const,
    trigger: 'api' as const,
    triggerDetail: 'deploy',
    commitSha: null,
    commitMessage: null,
    durationMs: null,
    createdAt: normalizeTimestamp(service.updated_at),
    failureSummary: null,
    isInProgress: true,
  };
}

function prependInFlightDeploy(
  deployments: DeployLogSummary[],
  service: ServiceRow | undefined | null,
  runtimeProject?: ProjectRow | null,
) {
  if (!service) return deployments;

  const serviceStatus = service.status as string | null;
  const projectStatus = runtimeProject?.status as string | null | undefined;
  if (serviceStatus !== 'building' && projectStatus !== 'building') {
    return deployments;
  }

  if (deployments.some((deployment) => deployment.id === service.id)) {
    return deployments;
  }

  return [mapInFlightDeploySummary(service), ...deployments];
}

function mapDeployLogDetail(log: DeployLogRow, project: ProjectRow) {
  return {
    id: log.id,
    projectId: log.project_id ?? project.id,
    status: log.status,
    trigger: log.trigger,
    triggerDetail: log.trigger_detail,
    commitSha: log.commit_sha,
    commitMessage: log.commit_message ?? null,
    buildLog: log.build_log,
    runtimeLog: log.runtime_log ?? null,
    durationMs: log.duration_ms,
    createdAt: normalizeTimestamp(log.created_at),
  };
}

async function deployLogBelongsToProject(
  ctx: AppContext,
  log: DeployLogRow,
  project: ProjectRow,
): Promise<boolean> {
  if (log.project_id === project.id) {
    return true;
  }

  const service = await ctx.db.getService(log.service_id);
  return service?.project_id === project.id;
}

export function createDeploymentRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/deployments', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const limit = parseLimit(c.req.query('limit'), 50);
    const environmentId = c.req.query('environmentId');
    const logs = await ctx.db.getDeployLogs(project.id, limit, environmentId);
    const deployable =
      typeof ctx.db.getDeployableForProject === 'function'
        ? await ctx.db.getDeployableForProject(project.id)
        : undefined;
    const deployments = prependInFlightDeploy(logs.map(mapDeployLogSummary), deployable, project);

    return c.json({
      count: deployments.length,
      deployments,
    });
  });

  api.get('/projects/:id/deployments/:deployId', async (c) => {
    const deployId = c.req.param('deployId');
    const project = await getProjectOrThrow(c, ctx);

    const log = await ctx.db.getDeployLog(deployId);
    if (!log || !(await deployLogBelongsToProject(ctx, log, project))) {
      return c.json({ error: 'NOT_FOUND', message: 'Deployment not found' }, 404);
    }

    return c.json(mapDeployLogDetail(log, project));
  });

  api.get('/projects/:p/services/:s/deployments', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { service } = resolved;

    const limit = parseLimit(c.req.query('limit'), 50);
    const environmentId = c.req.query('environmentId');
    const deployLogs = await ctx.db.getDeployLogs(service.id, limit, environmentId);
    const runtimeProject = await ctx.db.getProject(deployableServiceIdToProjectId(service.id));
    const deployments = prependInFlightDeploy(
      deployLogs.map(mapDeployLogSummary),
      service,
      runtimeProject,
    );
    return c.json({
      count: deployments.length,
      deployments,
    });
  });

  api.get('/deployments/recent', async (c) => {
    const limitParam = parseLimit(c.req.query('limit'), 20);
    const limit =
      Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
    const rows = await ctx.db.listRecentDeployLogsAcrossProjects(limit);
    const deployments = (
      await Promise.all(
        rows.map(async (dl) => {
          const service = await ctx.db.getService(dl.service_id);
          if (!service) return null;
          const project = await ctx.db.getProject(service.project_id);
          if (!project) return null;
          return {
            ...mapDeployLogSummary(dl),
            projectId: project.id,
            projectName: project.name,
            serviceId: service.id,
            serviceName: service.name,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    return c.json({ count: deployments.length, deployments });
  });

  return api;
}
