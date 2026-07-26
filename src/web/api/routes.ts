import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { OpenLanderError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createActivityRoutes } from './activity-routes.js';
import { createAiProviderRoutes } from './ai-provider-routes.js';
import { createAiOpsRoutes } from './ai-ops-routes.js';
import { createDataAccessRoutes } from './data-access-routes.js';
import { createDeploymentRoutes } from './deployment-routes.js';
import { createDeployStreamRoutes } from './deploy-stream-routes.js';
import { createDeployableServiceRoutes } from './deployable-service-routes.js';
import { createGitProvidersRoutes } from './git-providers-routes.js';
import { createGitCredentialRoutes } from './git-credential-routes.js';
import { createDeliveryRoutes } from './delivery-routes.js';
import { createEngagementRoutes } from './engagement-routes.js';
import { createOperationRoutes } from './operation-routes.js';
import { createEvidenceUploadRoutes } from './evidence-upload-routes.js';
import { createMcpStatusRoutes } from './mcp-status-routes.js';
import { createMonitoringRoutes } from './monitoring-routes.js';
import { createProjectGroupRoutes } from './project-group-routes.js';
import { createProjectCompatRoutes } from './project-compat-routes.js';
import { createServiceEnvRoutes } from './service-env-routes.js';
import { createServiceLogRoutes } from './service-log-routes.js';
import { createServiceRuntimeRoutes } from './service-runtime-routes.js';
import { createServiceAuxRoutes } from './service-aux-routes.js';
import { createServiceConnectionRoutes } from './service-connection-routes.js';
import { createProjectEnvRoutes } from './project-env-routes.js';
import { createSystemRoutes } from './system-routes.js';
import { createAiUsageRoutes } from './ai-usage-routes.js';
import { createApprovalRoutes } from './approval-routes.js';
import { createOpsRoutes } from './ops-routes.js';
import { createOverviewRoutes } from './overview-routes.js';
import { createNotificationsRoutes } from './notifications-routes.js';
import { createWebServerRoutes } from './web-server-routes.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getDeployableServiceRouteName, getProjectUrls } from '../../pipeline/traefik.js';
import { projectIdToDeployableServiceId } from '../../db/service-ids.js';
import type { ProjectRow, ServiceRow } from '../../db/types.js';
import { serviceViewFromRows } from '../../db/views/service-view.js';
import { normalizeDomainPathPrefix } from '../../db/repos/domain-mapping.repo.js';
import { isHttpRoutableRuntimeService } from '../../health/compose-runtime.js';

const log = createModuleLogger('api');
const API_SLOW_REQUEST_MS = 300;
const API_OBSERVE_REQUEST_MS = 150;

type TraefikHttpRouter = {
  rule: string;
  entryPoints: string[];
  service: string;
  priority?: number;
  middlewares?: string[];
};

const TRAEFIK_HTTP_PROVIDER_PRIORITY_BASE = 100_000;

function httpProviderPriority(rule: string): number {
  // Managed Traefik uses the HTTP provider as the app-route source of truth.
  // Keep a high priority anyway so DB-driven routes win deterministically if
  // an older/externally-managed Docker-label router for the same Host still
  // exists during upgrades or manual recovery.
  return TRAEFIK_HTTP_PROVIDER_PRIORITY_BASE + rule.length;
}

function readApprovalActionName(actionRun: { approval_tool: string | null; plan: string | null }) {
  if (actionRun.approval_tool === 'destructive_mcp' && actionRun.plan) {
    try {
      const parsed = JSON.parse(actionRun.plan) as Record<string, unknown>;
      const tool = parsed['tool'];
      if (typeof tool === 'string' && tool.length > 0) return tool;
    } catch {
      // Fall through to the approval queue name; approval resolution should
      // not fail just because an older action_run has malformed plan text.
    }
  }
  return actionRun.approval_tool ?? 'approval';
}
type TraefikHttpService = { loadBalancer: { servers: Array<{ url: string }> } };
type TraefikHttpMiddleware =
  { stripPrefix: { prefixes: string[] } } | { addPrefix: { prefix: string } };

const MANAGED_SERVICE_KINDS = new Set(['postgres', 'mysql', 'redis', 'mongo', 'minio']);

function traefikObjectName(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'route';
}

function domainRouteObjectName(mappingId: string): string {
  // Some legacy/generated mapping ids already carry a synthetic "domain-"
  // prefix. Strip only that leading marker so Traefik object names do not
  // become `domain-domain-*`.
  return traefikObjectName(mappingId.replace(/^domain[-_]+/i, ''));
}

const TRAEFIK_RULE_VALUE_RE = /^[A-Za-z0-9._~/-]+$/;

function isSafeTraefikRuleValue(value: string): boolean {
  return TRAEFIK_RULE_VALUE_RE.test(value);
}

function hostPathRule(domain: string, pathPrefix: string): string | null {
  if (!isSafeTraefikRuleValue(domain) || !isSafeTraefikRuleValue(pathPrefix)) {
    return null;
  }
  const hostRule = `Host(\`${domain}\`)`;
  return pathPrefix === '/' ? hostRule : `${hostRule} && PathPrefix(\`${pathPrefix}\`)`;
}

function resolveServiceContainerName(service: ServiceRow, project: ProjectRow): string | null {
  if (service.container_name) return service.container_name;
  if (service.id === projectIdToDeployableServiceId(project.id)) {
    return projectContainerName(project.name);
  }
  return null;
}

function serviceIsHttpProviderRoutable(service: ServiceRow): boolean {
  if (service.archived_at) return false;
  if (MANAGED_SERVICE_KINDS.has(service.kind)) return false;
  if (!isHttpRoutableRuntimeService(service)) return false;
  const status = service.status as ServiceRow['status'] | 'building';
  if (status === 'running') return true;
  return status === 'building' && Boolean(service.container_id);
}

export function createApiRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.use('*', async (c, next) => {
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      const durationMs = Date.now() - startedAt;
      const contentType = c.res.headers.get('content-type') ?? '';
      const isStreamingResponse =
        contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream');

      if (!isStreamingResponse) {
        const requestMeta = {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs,
        };

        if (durationMs >= API_SLOW_REQUEST_MS) {
          log.warn(requestMeta, 'Slow API request');
        } else if (durationMs >= API_OBSERVE_REQUEST_MS) {
          log.info(requestMeta, 'API request latency');
        }
      }
    }
  });

  // --- Error handler ---
  api.onError((err, c) => {
    if (err instanceof OpenLanderError) {
      return c.json(err.toJSON(), err.statusCode as 400);
    }
    log.error({ err }, 'API Error');
    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
  });

  // Auto-release deploy locks on completion/failure (session-scoped to prevent lock stealing)
  eventBus.on('deploy:success', (p) => {
    void ctx.db.releaseDeployLock(p.projectId, p.sessionId).catch((err: unknown) => {
      log.warn({ err, projectId: p.projectId }, 'Failed to release deploy lock');
    });
  });
  eventBus.on('deploy:failed', (p) => {
    void ctx.db.releaseDeployLock(p.projectId, p.sessionId).catch((err: unknown) => {
      log.warn({ err, projectId: p.projectId }, 'Failed to release deploy lock');
    });
  });
  eventBus.on('compose:up', (p) => {
    void ctx.db.releaseDeployLock(p.projectId, p.sessionId).catch((err: unknown) => {
      log.warn({ err, projectId: p.projectId }, 'Failed to release deploy lock');
    });
  });
  eventBus.on('compose:failed', (p) => {
    void ctx.db.releaseDeployLock(p.projectId, p.sessionId).catch((err: unknown) => {
      log.warn({ err, projectId: p.projectId }, 'Failed to release deploy lock');
    });
  });

  // --- Global Secrets ---

  api.get('/secrets', (c) => {
    const secrets = ctx.env.getGlobalSecretsMasked();
    return c.json({ secrets });
  });

  api.get('/action-runs', async (c) => {
    const approvalStatus = c.req.query('approval_status');
    if (!approvalStatus) {
      return c.json({ actionRuns: [] });
    }

    if (
      approvalStatus !== 'pending' &&
      approvalStatus !== 'approved' &&
      approvalStatus !== 'rejected'
    ) {
      return c.json({ error: 'INVALID_FIELD', message: 'approval_status is invalid' }, 400);
    }

    const actionRuns = (await ctx.db.getActionRunsByApprovalStatus(approvalStatus, 20)).map(
      (run) => ({
        ...run,
        recovery_strategy: run.recovery_strategy === 'unknown' ? null : run.recovery_strategy,
      }),
    );
    return c.json({ actionRuns });
  });

  api.post('/action-runs/:id/approve', async (c) => {
    const id = c.req.param('id');
    const actionRun = await ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    await ctx.db.updateActionRunApproval(id, 'approved', actionRun.approval_tool ?? undefined);
    await eventBus.emit('recovery:approval-resolved', {
      actionRunId: id,
      approved: true,
      projectId: actionRun.project_id,
      toolName: readApprovalActionName(actionRun),
      approvalTool: actionRun.approval_tool ?? undefined,
      resolvedBy: 'web-session',
    });

    return c.json({ success: true, actionRunId: id, status: 'approved' });
  });

  api.post('/action-runs/:id/reject', async (c) => {
    const id = c.req.param('id');
    const actionRun = await ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    await ctx.db.updateActionRunApproval(id, 'rejected', actionRun.approval_tool ?? undefined);
    await eventBus.emit('recovery:approval-resolved', {
      actionRunId: id,
      approved: false,
      projectId: actionRun.project_id,
      toolName: readApprovalActionName(actionRun),
      approvalTool: actionRun.approval_tool ?? undefined,
      resolvedBy: 'web-session',
    });

    return c.json({ success: true, actionRunId: id, status: 'rejected' });
  });

  api.post('/secrets', async (c) => {
    const body = await c.req.json<{ key: string; value: string; description?: string }>();
    if (!body.key || !body.value) {
      return c.json({ error: 'MISSING_FIELD', message: 'key and value are required' }, 400);
    }
    await ctx.env.setGlobalSecret(body.key, body.value, body.description);
    return c.json({ status: 'saved', key: body.key });
  });

  api.delete('/secrets/:key', async (c) => {
    const key = c.req.param('key');
    const deleted = await ctx.env.deleteGlobalSecret(key);
    if (!deleted) {
      return c.json({ error: 'NOT_FOUND', message: `Secret "${key}" not found` }, 404);
    }
    return c.json({ status: 'deleted', key });
  });

  api.get('/traefik/config', async (c) => {
    const routers: Record<string, TraefikHttpRouter> = {};
    const traefikServices: Record<string, TraefikHttpService> = {};
    const middlewares: Record<string, TraefikHttpMiddleware> = {};

    // Build self-contained services for projects with an active container.
    // Uses Docker DNS (container name) + container port — no @docker dependency.
    // Includes 'building' status to keep routes alive during blue-green deploys.
    //
    // PR 4 canonical-first: read status / container_id / container_port /
    // assigned_port via the deployable services row when available; fall
    // back to legacy projects columns through migration 0012.
    const [projects, serviceRows, mappings] = await Promise.all([
      ctx.db.listProjects(),
      ctx.db.listServices(),
      ctx.db.listDomainMappings(),
    ]);
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const servicesById = new Map(serviceRows.map((service) => [service.id, service]));
    const deployablesByProjectId = new Map(
      projects.map((project) => [
        project.id,
        servicesById.get(projectIdToDeployableServiceId(project.id)),
      ]),
    );
    const addHttpProviderService = (
      serviceName: string,
      containerName: string,
      internalPort: number,
    ): boolean => {
      if (traefikServices[serviceName]) {
        log.warn({ serviceName }, 'Skipping Traefik HTTP service with colliding object name');
        return false;
      }
      traefikServices[serviceName] = {
        loadBalancer: {
          servers: [{ url: `http://${containerName}:${String(internalPort)}` }],
        },
      };
      return true;
    };
    const addAutoHostRouters = (routeName: string, serviceName: string): void => {
      for (const route of getProjectUrls(routeName)) {
        const host = new URL(route.url).hostname;
        if (!host) continue;
        const rule = `Host(\`${host}\`)`;
        const routerName = `route-${routeName}-${traefikObjectName(`${route.type}-${host}`)}`;
        if (routers[routerName]) {
          log.warn({ routerName, routeName }, 'Skipping colliding Traefik HTTP router');
          continue;
        }
        routers[routerName] = {
          rule,
          entryPoints: ['web'],
          service: serviceName,
          priority: httpProviderPriority(rule),
        };
      }
    };
    const allProjects: ProjectRow[] = [];
    for (const p of projects) {
      // S2.4 canonical-first via the service-first read model: status +
      // container_id from the deployable services row, then the
      // deprecated project columns. The view's 'idle' bottom is inert
      // here — the filter only matches 'running' / 'building'.
      const view = serviceViewFromRows(p, deployablesByProjectId.get(p.id));
      if (view.status === 'running' || (view.status === 'building' && view.containerId)) {
        allProjects.push(p);
      }
    }
    for (const project of allProjects) {
      const deployable = deployablesByProjectId.get(project.id);
      if (!deployable) continue;
      // S2.4 canonical-first via the service-first read model: container_port
      // then assigned_port, each canonical-first over the project column.
      const view = serviceViewFromRows(project, deployable);
      const internalPort = view.containerPort ?? view.assignedPort;
      if (!internalPort) continue;
      // resolveServiceContainerName needs the raw services row for its
      // identity check (id === `${project}__svc`) and project-name
      // fallback, so the deployable row is kept rather than the view.
      const containerName = resolveServiceContainerName(deployable, project);
      if (!containerName) {
        log.warn(
          { projectId: project.id, projectName: project.name },
          'Skipping auto route without a resolvable service container name',
        );
        continue;
      }
      const svcName = `svc-${project.name}`;
      addHttpProviderService(svcName, containerName, internalPort);
    }

    for (const service of serviceRows) {
      const project = projectsById.get(service.project_id);
      if (!project) continue;
      if (service.id === projectIdToDeployableServiceId(project.id)) continue;
      if (!serviceIsHttpProviderRoutable(service)) continue;

      const internalPort = service.container_port ?? service.assigned_port;
      if (!internalPort) continue;

      const containerName = resolveServiceContainerName(service, project);
      if (!containerName) {
        log.warn(
          { serviceId: service.id, projectId: service.project_id },
          'Skipping non-canonical auto route without a resolvable service container name',
        );
        continue;
      }

      const routeName = getDeployableServiceRouteName(service);
      const svcName = `svc-${routeName}`;
      if (addHttpProviderService(svcName, containerName, internalPort)) {
        addAutoHostRouters(routeName, svcName);
      }
    }

    const previewDeployer = (ctx as Partial<Pick<AppContext, 'previewDeployer'>>).previewDeployer;
    for (const preview of previewDeployer?.list() ?? []) {
      if (!preview.routeName || !preview.containerName || !preview.containerPort) continue;
      const svcName = `svc-${preview.routeName}`;
      if (addHttpProviderService(svcName, preview.containerName, preview.containerPort)) {
        addAutoHostRouters(preview.routeName, svcName);
      }
    }

    for (const mapping of mappings) {
      if (mapping.status !== 'active') continue;

      const service = servicesById.get(mapping.service_id);
      const serviceStatus = service?.status as ServiceRow['status'] | 'building' | undefined;
      const isRoutable =
        serviceStatus === 'running' || (serviceStatus === 'building' && service?.container_id);
      if (
        !service ||
        service.archived_at ||
        !isRoutable ||
        !isHttpRoutableRuntimeService(service)
      ) {
        continue;
      }

      const project = projectsById.get(service.project_id);
      if (!project) continue;

      if (
        mapping.target_port !== null &&
        (!Number.isInteger(mapping.target_port) ||
          mapping.target_port < 1 ||
          mapping.target_port > 65535)
      ) {
        log.warn(
          { serviceId: service.id, domain: mapping.domain, targetPort: mapping.target_port },
          'Skipping domain mapping with invalid target port',
        );
        continue;
      }

      const internalPort = mapping.target_port ?? service.container_port ?? service.assigned_port;
      const containerName = resolveServiceContainerName(service, project);
      if (!internalPort) continue;
      if (!containerName) {
        log.warn(
          { serviceId: service.id, domain: mapping.domain },
          'Skipping domain mapping without a resolvable service container name',
        );
        continue;
      }

      const routeObjectName = domainRouteObjectName(mapping.id);
      const pathPrefix = normalizeDomainPathPrefix(mapping.path_prefix);
      const rule = hostPathRule(mapping.domain, pathPrefix);
      if (!rule) {
        log.warn(
          { serviceId: service.id, domain: mapping.domain, pathPrefix },
          'Skipping domain mapping with unsafe Traefik rule value',
        );
        continue;
      }

      const svcName = `svc-domain-${routeObjectName}`;
      const routerName = `domain-${routeObjectName}`;
      if (routers[routerName] || traefikServices[svcName]) {
        log.warn(
          { mappingId: mapping.id, serviceId: service.id, domain: mapping.domain },
          'Skipping domain mapping with colliding Traefik object name',
        );
        continue;
      }

      addHttpProviderService(svcName, containerName, internalPort);

      const routerMiddlewares: string[] = [];
      if (mapping.strip_prefix && pathPrefix !== '/') {
        const middlewareName = `${routerName}-strip`;
        middlewares[middlewareName] = { stripPrefix: { prefixes: [pathPrefix] } };
        routerMiddlewares.push(middlewareName);
      }

      const upstreamPathPrefix = normalizeDomainPathPrefix(mapping.upstream_path_prefix);
      if (upstreamPathPrefix !== '/') {
        if (!isSafeTraefikRuleValue(upstreamPathPrefix)) {
          log.warn(
            { serviceId: service.id, domain: mapping.domain, upstreamPathPrefix },
            'Skipping AddPrefix middleware with unsafe value',
          );
        } else {
          const middlewareName = `${routerName}-add`;
          middlewares[middlewareName] = { addPrefix: { prefix: upstreamPathPrefix } };
          // Order matters: StripPrefix first removes the public path, then
          // AddPrefix maps the request into the service's internal route tree.
          routerMiddlewares.push(middlewareName);
        }
      }

      routers[routerName] = {
        rule,
        entryPoints: ['web'],
        service: svcName,
        priority: httpProviderPriority(rule),
        ...(routerMiddlewares.length > 0 ? { middlewares: routerMiddlewares } : {}),
      };
    }

    for (const project of allProjects) {
      const svcName = `svc-${project.name}`;
      if (!traefikServices[svcName]) continue;
      addAutoHostRouters(project.name, svcName);

      // S2.4 canonical-first via the service-first read model: visibility
      // + public_url from the deployable services row, then the deprecated
      // project columns. The view's 'internal' visibility bottom matches
      // the legacy `?? project.visibility` undefined → non-share outcome.
      const view = serviceViewFromRows(project, deployablesByProjectId.get(project.id));
      const visibility = view.visibility;
      const publicUrl = view.publicUrl;
      if ((visibility === 'quick-share' || visibility === 'shared') && publicUrl) {
        try {
          const host = new URL(publicUrl).hostname;
          const rule = `Host(\`${host}\`)`;
          routers[`qs-${project.name}`] = {
            rule,
            entryPoints: ['web'],
            service: svcName,
            priority: httpProviderPriority(rule),
          };
        } catch {
          // skip invalid URL
        }
      }
    }

    const httpConfig =
      Object.keys(middlewares).length > 0
        ? { routers, services: traefikServices, middlewares }
        : { routers, services: traefikServices };

    return c.json({ http: httpConfig });
  });

  api.route('/', createActivityRoutes(ctx));
  api.route('/', createAiProviderRoutes(ctx));
  api.route('/', createAiOpsRoutes(ctx));
  api.route('/', createDataAccessRoutes(ctx));
  api.route('/', createMcpStatusRoutes(ctx));
  api.route('/', createMonitoringRoutes(ctx));
  api.route('/', createDeployStreamRoutes(ctx));
  api.route('/', createProjectGroupRoutes(ctx));
  api.route('/', createDeployableServiceRoutes(ctx));
  api.route('/', createServiceEnvRoutes(ctx));
  api.route('/', createServiceLogRoutes(ctx));
  api.route('/', createDeploymentRoutes(ctx));
  api.route('/', createServiceRuntimeRoutes(ctx));
  api.route('/', createServiceAuxRoutes(ctx));
  api.route('/', createServiceConnectionRoutes(ctx));
  api.route('/', createProjectEnvRoutes(ctx));
  api.route('/', createProjectCompatRoutes(ctx));
  api.route('/', createSystemRoutes(ctx));
  api.route('/', createAiUsageRoutes(ctx));
  api.route('/', createApprovalRoutes(ctx));
  api.route('/ops', createOpsRoutes(ctx));
  api.route('/', createOverviewRoutes(ctx));
  api.route('/', createNotificationsRoutes(ctx));
  api.route('/', createWebServerRoutes(ctx));
  api.route('/', createGitProvidersRoutes(ctx));
  api.route('/', createGitCredentialRoutes(ctx));
  api.route('/', createDeliveryRoutes(ctx));
  api.route('/', createEngagementRoutes(ctx));
  api.route('/', createOperationRoutes(ctx));
  api.route('/', createEvidenceUploadRoutes(ctx));

  return api;
}
