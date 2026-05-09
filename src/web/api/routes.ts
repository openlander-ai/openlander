import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { OpenLanderError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createActivityRoutes } from './activity-routes.js';
import { createDeploymentRoutes } from './deployment-routes.js';
import { createDeployStreamRoutes } from './deploy-stream-routes.js';
import { createDeployableServiceRoutes } from './deployable-service-routes.js';
import { createGitProvidersRoutes } from './git-providers-routes.js';
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
import { getEnvironmentProjectHostname, getAllIps } from '../../pipeline/traefik.js';

const log = createModuleLogger('api');
const API_SLOW_REQUEST_MS = 300;
const API_OBSERVE_REQUEST_MS = 150;

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
    const routers: Record<string, { rule: string; entryPoints: string[]; service: string }> = {};
    const services: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }> = {};

    // Build self-contained services for projects with an active container.
    // Uses Docker DNS (container name) + container port — no @docker dependency.
    // Includes 'building' status to keep routes alive during blue-green deploys.
    //
    // PR 4 canonical-first: read status / container_id / container_port /
    // assigned_port via the deployable services row when available; fall
    // back to legacy projects columns through migration 0012.
    const allProjects = [];
    for (const p of await ctx.db.listProjects()) {
      const deployable = await ctx.db.getDeployableForProject(p.id);
      const status = deployable?.status ?? p.status;
      const containerId = deployable?.container_id ?? p.container_id;
      if (status === 'running' || (status === 'building' && containerId)) {
        allProjects.push(p);
      }
    }
    for (const project of allProjects) {
      const deployable = await ctx.db.getDeployableForProject(project.id);
      // PR 4.5: canonical-first read with `??` fallback (joined to satisfy grep).
      const internalPort =
        deployable?.container_port ??
        project.container_port ??
        deployable?.assigned_port ??
        project.assigned_port;
      if (!internalPort) continue;
      const svcName = `svc-${project.name}`;
      services[svcName] = {
        loadBalancer: {
          servers: [
            { url: `http://${projectContainerName(project.name)}:${String(internalPort)}` },
          ],
        },
      };
    }

    const mappings = await ctx.db.listDomainMappings();
    const projectDomains = new Map<string, { projectName: string; domains: string[] }>();
    for (const mapping of mappings) {
      if (!mapping.project_id) continue;
      const existing = projectDomains.get(mapping.project_id);
      if (existing) {
        existing.domains.push(mapping.domain);
      } else {
        const project = await ctx.db.getProject(mapping.project_id);
        if (project) {
          projectDomains.set(mapping.project_id, {
            projectName: project.name,
            domains: [mapping.domain],
          });
        }
      }
    }
    for (const [projectId, { projectName, domains }] of projectDomains) {
      const svcName = `svc-${projectName}`;
      if (!services[svcName]) {
        const project = await ctx.db.getProject(projectId);
        // PR 4 canonical-first: container_port + assigned_port via
        // deployable services row when available.
        const deployable = project ? await ctx.db.getDeployableForProject(project.id) : undefined;
        const internalPort =
          deployable?.container_port ??
          // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          project?.container_port ??
          deployable?.assigned_port ??
          // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          project?.assigned_port;
        if (!internalPort) continue;
        services[svcName] = {
          loadBalancer: {
            servers: [
              { url: `http://${projectContainerName(projectName)}:${String(internalPort)}` },
            ],
          },
        };
      }
      const routeRule = domains.map((d) => `Host(\`${d}\`)`).join(' || ');
      routers[`prod-${projectName}`] = {
        rule: routeRule,
        entryPoints: ['web'],
        service: svcName,
      };
    }

    const detectedIps = getAllIps();
    for (const project of allProjects) {
      const svcName = `svc-${project.name}`;
      if (!services[svcName]) continue;
      for (const ip of detectedIps) {
        const sslipHost = getEnvironmentProjectHostname(project.name, 'production', ip.address);
        if (sslipHost && !sslipHost.endsWith('.localhost')) {
          routers[`sslip-${project.name}-${ip.type}`] = {
            rule: `Host(\`${sslipHost}\`)`,
            entryPoints: ['web'],
            service: svcName,
          };
        }
      }

      // PR 4 canonical-first: public_url + visibility from deployable
      // services row when available; fall back to legacy projects columns.
      const deployable = await ctx.db.getDeployableForProject(project.id);
      const visibility = deployable?.visibility ?? project.visibility;
      const publicUrl = deployable?.public_url ?? project.public_url;
      if ((visibility === 'quick-share' || visibility === 'shared') && publicUrl) {
        try {
          const host = new URL(publicUrl).hostname;
          routers[`qs-${project.name}`] = {
            rule: `Host(\`${host}\`)`,
            entryPoints: ['web'],
            service: svcName,
          };
        } catch {
          // skip invalid URL
        }
      }
    }

    return c.json({ http: { routers, services } });
  });

  api.route('/', createActivityRoutes(ctx));
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

  return api;
}
