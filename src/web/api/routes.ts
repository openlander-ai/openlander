import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import { OpenLanderError } from '../../errors.js';
import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createDeployStreamRoutes } from './deploy-stream-routes.js';
import { createProjectRoutes } from './project-routes.js';
import { createSystemRoutes } from './system-routes.js';
import { createAiUsageRoutes } from './ai-usage-routes.js';
import { createApprovalRoutes } from './approval-routes.js';
import { createOpsRoutes } from './ops-routes.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getEnvironmentProjectHostname, getAllIps } from '../../pipeline/traefik.js';

const log = createModuleLogger('api');
const API_SLOW_REQUEST_MS = 300;
const API_OBSERVE_REQUEST_MS = 150;

interface ActivityEvent {
  type: string;
  project: string;
  user: string;
  status: string;
  detail?: string;
  time: string;
}

const activityBuffer: ActivityEvent[] = [];
const MAX_ACTIVITY = 100;

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

  // --- Event Subscription for Activity Buffer ---

  const eventToStatus: Partial<Record<EventType, string>> = {
    'deploy:start': 'building',
    'deploy:clone': 'cloning',
    'deploy:build': 'building',
    'deploy:run': 'starting',
    'deploy:success': 'running',
    'deploy:failed': 'error',
    'deploy:rollback': 'rolling-back',
    'container:start': 'running',
    'container:stop': 'stopped',
    'container:remove': 'removed',
    'container:health': 'health-check',
    'compose:start': 'building',
    'compose:up': 'running',
    'compose:failed': 'error',
    'tunnel:start': 'tunnel-starting',
    'tunnel:stop': 'tunnel-stopped',
    'tunnel:url': 'tunnel-active',
    'env:set': 'env-updated',
    'env:delete': 'env-deleted',
    'recovery:start': 'recovering',
    'recovery:success': 'recovered',
    'recovery:failed': 'recovery-failed',
    'recovery:exhausted': 'recovery-exhausted',
    'recovery:approval-needed': 'approval-pending',
    'recovery:approval-resolved': 'approval-resolved',
    'alert:new': 'alert-new',
    'alert:resolved': 'alert-resolved',
  };

  const eventTypes: EventType[] = [
    'deploy:start',
    'deploy:clone',
    'deploy:build',
    'deploy:run',
    'deploy:success',
    'deploy:failed',
    'deploy:rollback',
    'container:start',
    'container:stop',
    'container:remove',
    'container:health',
    'tunnel:start',
    'tunnel:stop',
    'tunnel:url',
    'env:set',
    'env:delete',
    'compose:start',
    'compose:up',
    'compose:failed',
    'recovery:start',
    'recovery:success',
    'recovery:failed',
    'recovery:exhausted',
    'recovery:approval-needed',
    'recovery:approval-resolved',
    'alert:new',
    'alert:resolved',
  ];

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
      let projectId = (payload as { projectId?: string }).projectId;

      if (eventType === 'alert:new') {
        projectId = (payload as EventPayload['alert:new']).alert.details.projectId as
          | string
          | undefined;
      }

      if (!projectId) return;

      const project = ctx.db.getProject(projectId);
      const projectName = project?.name ?? projectId;
      const status = eventToStatus[eventType] ?? 'unknown';

      const activityEvent: ActivityEvent = {
        type: eventType,
        project: projectName,
        user: 'system',
        status,
        time: new Date().toISOString(),
      };

      if (eventType === 'deploy:failed') {
        activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
      } else if (eventType === 'tunnel:url') {
        activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
      } else if (eventType === 'compose:failed') {
        activityEvent.detail = (payload as EventPayload['compose:failed']).error;
      } else if (eventType === 'recovery:start') {
        activityEvent.detail = (payload as EventPayload['recovery:start']).error;
      } else if (eventType === 'recovery:failed') {
        activityEvent.detail = (payload as EventPayload['recovery:failed']).error;
      } else if (eventType === 'recovery:exhausted') {
        activityEvent.detail = (payload as EventPayload['recovery:exhausted']).lastError;
      } else if (eventType === 'alert:new') {
        activityEvent.detail = (payload as EventPayload['alert:new']).alert.message;
      }

      activityBuffer.push(activityEvent);
      if (activityBuffer.length > MAX_ACTIVITY) {
        activityBuffer.shift();
      }
    });
  }

  // Auto-release deploy locks on completion/failure
  eventBus.on('deploy:success', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('deploy:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:up', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });

  // --- Activity Streaming ---

  api.get('/activity', (c) => {
    const follow = c.req.query('follow');

    if (follow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        const unsubscribers: Array<() => void> = [];
        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              let projectId = (payload as { projectId?: string }).projectId;

              if (eventType === 'alert:new') {
                projectId = (payload as EventPayload['alert:new']).alert.details.projectId as
                  | string
                  | undefined;
              }

              if (!projectId) return;

              const project = ctx.db.getProject(projectId);
              const projectName = project?.name ?? projectId;
              const status = eventToStatus[eventType] ?? 'unknown';

              const activityEvent: ActivityEvent = {
                type: eventType,
                project: projectName,
                user: 'system',
                status,
                time: new Date().toISOString(),
              };

              if (eventType === 'deploy:failed') {
                activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
              } else if (eventType === 'tunnel:url') {
                activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
              } else if (eventType === 'recovery:start') {
                activityEvent.detail = (payload as EventPayload['recovery:start']).error;
              } else if (eventType === 'recovery:failed') {
                activityEvent.detail = (payload as EventPayload['recovery:failed']).error;
              } else if (eventType === 'recovery:exhausted') {
                activityEvent.detail = (payload as EventPayload['recovery:exhausted']).lastError;
              } else if (eventType === 'alert:new') {
                activityEvent.detail = (payload as EventPayload['alert:new']).alert.message;
              }

              void s.write(JSON.stringify(activityEvent) + '\n');
            }),
          );
        }

        s.onAbort(() => {
          for (const unsub of unsubscribers) {
            unsub();
          }
        });

        await Promise.resolve();
      });
    }

    return c.json({ activities: activityBuffer.slice(-20) });
  });

  // --- Global Secrets ---

  api.get('/secrets', (c) => {
    const secrets = ctx.env.getGlobalSecretsMasked();
    return c.json({ secrets });
  });

  api.get('/action-runs', (c) => {
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

    const actionRuns = ctx.db.getActionRunsByApprovalStatus(approvalStatus, 20);
    return c.json({ actionRuns });
  });

  api.post('/action-runs/:id/approve', async (c) => {
    const id = c.req.param('id');
    const actionRun = ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    ctx.db.updateActionRunApproval(id, 'approved', actionRun.approval_tool ?? undefined);
    await eventBus.emit('recovery:approval-resolved', { actionRunId: id, approved: true });

    return c.json({ success: true, actionRunId: id, status: 'approved' });
  });

  api.post('/action-runs/:id/reject', async (c) => {
    const id = c.req.param('id');
    const actionRun = ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    ctx.db.updateActionRunApproval(id, 'rejected', actionRun.approval_tool ?? undefined);
    await eventBus.emit('recovery:approval-resolved', { actionRunId: id, approved: false });

    return c.json({ success: true, actionRunId: id, status: 'rejected' });
  });

  api.post('/secrets', async (c) => {
    const body = await c.req.json<{ key: string; value: string; description?: string }>();
    if (!body.key || !body.value) {
      return c.json({ error: 'MISSING_FIELD', message: 'key and value are required' }, 400);
    }
    ctx.env.setGlobalSecret(body.key, body.value, body.description);
    return c.json({ status: 'saved', key: body.key });
  });

  api.delete('/secrets/:key', (c) => {
    const key = c.req.param('key');
    const deleted = ctx.env.deleteGlobalSecret(key);
    if (!deleted) {
      return c.json({ error: 'NOT_FOUND', message: `Secret "${key}" not found` }, 404);
    }
    return c.json({ status: 'deleted', key });
  });

  api.get('/traefik/config', (c) => {
    const routers: Record<string, { rule: string; entryPoints: string[]; service: string }> = {};

    const mappings = ctx.db.listDomainMappings();
    const projectDomains = new Map<string, { projectName: string; domains: string[] }>();
    for (const mapping of mappings) {
      const existing = projectDomains.get(mapping.project_id);
      if (existing) {
        existing.domains.push(mapping.domain);
      } else {
        const project = ctx.db.getProject(mapping.project_id);
        if (project) {
          projectDomains.set(mapping.project_id, {
            projectName: project.name,
            domains: [mapping.domain],
          });
        }
      }
    }
    for (const [, { projectName, domains }] of projectDomains) {
      const routeRule = domains.map((d) => `Host(\`${d}\`)`).join(' || ');
      routers[`prod-${projectName}`] = {
        rule: routeRule,
        entryPoints: ['web'],
        service: `${projectContainerName(projectName)}@docker`,
      };
    }

    const allProjects = ctx.db.listProjects('running');
    const detectedIps = getAllIps();
    for (const project of allProjects) {
      for (const ip of detectedIps) {
        const sslipHost = getEnvironmentProjectHostname(project.name, 'production', ip.address);
        if (sslipHost && !sslipHost.endsWith('.localhost')) {
          routers[`sslip-${project.name}-${ip.type}`] = {
            rule: `Host(\`${sslipHost}\`)`,
            entryPoints: ['web'],
            service: `${projectContainerName(project.name)}@docker`,
          };
        }
      }

      if (
        (project.visibility === 'quick-share' || project.visibility === 'shared') &&
        project.public_url
      ) {
        try {
          const host = new URL(project.public_url).hostname;
          routers[`qs-${project.name}`] = {
            rule: `Host(\`${host}\`)`,
            entryPoints: ['web'],
            service: `${projectContainerName(project.name)}@docker`,
          };
        } catch {
          // skip invalid URL
        }
      }
    }

    return c.json({ http: { routers } });
  });

  api.route('/', createDeployStreamRoutes(ctx));
  api.route('/', createProjectRoutes(ctx));
  api.route('/', createSystemRoutes(ctx));
  api.route('/', createAiUsageRoutes(ctx));
  api.route('/', createApprovalRoutes(ctx));
  api.route('/ops', createOpsRoutes(ctx));

  return api;
}
