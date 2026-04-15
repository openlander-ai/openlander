import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import type { ActivityLogRow } from '../../db/types.js';
import { OpenLanderError } from '../../errors.js';
import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { type ActivityEvent, buildActivityEvent } from '../../monitor/activity-event-mapper.js';
import { createDeployStreamRoutes } from './deploy-stream-routes.js';
import { createProjectRoutes } from './project-routes.js';
import { createSystemRoutes } from './system-routes.js';
import { createAiUsageRoutes } from './ai-usage-routes.js';
import { createApprovalRoutes } from './approval-routes.js';
import { createOpsRoutes } from './ops-routes.js';
import { createOverviewRoutes } from './overview-routes.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getEnvironmentProjectHostname, getAllIps } from '../../pipeline/traefik.js';

const log = createModuleLogger('api');
const API_SLOW_REQUEST_MS = 300;
const API_OBSERVE_REQUEST_MS = 150;

const ACTIVITY_TYPES = [
  'incident',
  'recovery',
  'approval',
  'circuit_breaker',
  'cleanup',
  'alert',
  'ai_diagnosis',
  'ai:invoked',
  'ai:completed',
  'recovery:blocked',
  'recovery:stopped',
  'recovery:started',
] as const;

function isActivityType(value: string): value is ActivityEvent['type'] {
  return (ACTIVITY_TYPES as readonly string[]).includes(value);
}

function parseActivityTypeFilter(raw: string | undefined): Set<ActivityEvent['type']> | null {
  if (!raw) return null;
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter(isActivityType);
  if (parsed.length === 0) return null;
  return new Set(parsed);
}

function parseSeverityFilter(raw: string | undefined): ActivityEvent['severity'] | null {
  if (raw === 'critical' || raw === 'warning' || raw === 'info') return raw;
  return null;
}

function shouldIncludeActivity(
  event: ActivityEvent,
  filters: {
    projectId?: string;
    types?: Set<ActivityEvent['type']> | null;
    severity?: ActivityEvent['severity'] | null;
  },
): boolean {
  if (filters.projectId && event.projectId !== filters.projectId) return false;
  if (filters.types && !filters.types.has(event.type)) return false;
  if (filters.severity && event.severity !== filters.severity) return false;
  return true;
}

/**
 * Convert an ActivityLogRow from the database into the ActivityEvent shape
 * consumed by the frontend useActivityStream hook.
 */
function activityLogRowToEvent(row: ActivityLogRow, projectName: string): ActivityEvent {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    // ignore malformed metadata
  }

  return {
    id: row.id,
    timestamp: row.created_at,
    type: row.activity_type as ActivityEvent['type'],
    severity: row.severity as ActivityEvent['severity'],
    projectId: row.project_id,
    projectName,
    title: row.title,
    description: row.description,
    status: row.status as ActivityEvent['status'],
    incidentId: typeof metadata.incidentId === 'string' ? metadata.incidentId : undefined,
    actionRunId: typeof metadata.actionRunId === 'string' ? metadata.actionRunId : undefined,
    correlationId: row.correlation_id ?? undefined,
    aiMetadata: metadata.aiMetadata as ActivityEvent['aiMetadata'],
    rawType: row.event_type as EventType,
    project: projectName,
    user: 'system',
    detail: row.description || undefined,
    time: row.created_at,
    reason: typeof metadata.reason === 'string' ? metadata.reason : undefined,
  };
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

  // --- Event types for SSE streaming ---

  const eventTypes: EventType[] = [
    'deploy:start',
    'deploy:clone',
    'deploy:build',
    'deploy:run',
    'deploy:success',
    'deploy:failed',
    'deploy:crash',
    'deploy:rollback',
    'container:start',
    'container:stop',
    'container:remove',
    'container:health',
    'container:die',
    'container:oom',
    'container:missing',
    'tunnel:start',
    'tunnel:stop',
    'tunnel:url',
    'env:set',
    'env:delete',
    'compose:start',
    'compose:up',
    'compose:failed',
    'monitor:inactive',
    'health:degraded',
    'recovery:start',
    'recovery:success',
    'recovery:failed',
    'recovery:exhausted',
    'recovery:approval-needed',
    'recovery:approval-resolved',
    'recovery:blocked',
    'recovery:stopped',
    'recovery:started',
    'ai:invoked',
    'ai:completed',
    'alert:new',
    'alert:resolved',
  ];

  // Auto-release deploy locks on completion/failure (session-scoped to prevent lock stealing)
  eventBus.on('deploy:success', (p) => {
    ctx.db.releaseDeployLock(p.projectId, p.sessionId);
  });
  eventBus.on('deploy:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId, p.sessionId);
  });
  eventBus.on('compose:up', (p) => {
    ctx.db.releaseDeployLock(p.projectId, p.sessionId);
  });
  eventBus.on('compose:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId, p.sessionId);
  });

  // --- Helper: resolve project names for activity log rows ---

  function resolveActivityRows(rows: ActivityLogRow[]): ActivityEvent[] {
    const projectNameCache = new Map<string, string>();
    return rows.map((row) => {
      let name = projectNameCache.get(row.project_id);
      if (name === undefined) {
        const project = ctx.db.getProject(row.project_id);
        name = project?.name ?? row.project_id;
        projectNameCache.set(row.project_id, name);
      }
      return activityLogRowToEvent(row, name);
    });
  }

  // --- Activity Endpoint (DB-backed with SSE gap recovery) ---

  api.get('/activity', (c) => {
    const follow = c.req.query('follow');
    const sinceId = c.req.query('since') ?? undefined;
    const projectIdFilter = c.req.query('projectId') ?? undefined;
    const typeFilter = parseActivityTypeFilter(c.req.query('types'));
    const severityFilter = parseSeverityFilter(c.req.query('severity'));
    const correlationIdFilter = c.req.query('correlationId') ?? undefined;
    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

    // Build DB filter object from query params.
    // Note: activity_type filter uses comma-separated types from ?types= param;
    // we pass the first value for DB-level filtering and apply full set in-memory.
    const dbFilters: {
      project_id?: string;
      activity_type?: string;
      severity?: string;
      correlation_id?: string;
    } = {};
    if (projectIdFilter) dbFilters.project_id = projectIdFilter;
    if (severityFilter) dbFilters.severity = severityFilter;
    if (correlationIdFilter) dbFilters.correlation_id = correlationIdFilter;
    // When a single type is requested, push it to the DB filter for efficiency
    if (typeFilter && typeFilter.size === 1) {
      dbFilters.activity_type = [...typeFilter][0];
    }

    if (follow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        // Step 1: Register EventBus listener FIRST to buffer live events during backfill
        const liveBuffer: ActivityEvent[] = [];
        let backfillComplete = !sinceId; // no backfill needed if no since param
        const unsubscribers: Array<() => void> = [];

        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              const activityEvent = buildActivityEvent(ctx.db, eventType, payload);
              if (!activityEvent) return;
              if (
                !shouldIncludeActivity(activityEvent, {
                  projectId: projectIdFilter,
                  types: typeFilter,
                  severity: severityFilter,
                })
              ) {
                return;
              }
              if (!backfillComplete) {
                // Buffer events that arrive during backfill query
                liveBuffer.push(activityEvent);
              } else {
                void s.write(JSON.stringify(activityEvent) + '\n');
              }
            }),
          );
        }

        s.onAbort(() => {
          for (const unsub of unsubscribers) {
            unsub();
          }
        });

        // Step 2: If since param provided, query missed events and send as backfill
        if (sinceId) {
          try {
            const missedRows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
            const missedEvents = resolveActivityRows(missedRows);

            // Apply multi-type filter in-memory (DB only filters single type)
            const filtered =
              typeFilter && typeFilter.size > 1
                ? missedEvents.filter((e) => typeFilter.has(e.type))
                : missedEvents;

            // Step 3: Send backfill events with backfill flag
            for (const event of filtered) {
              await s.write(JSON.stringify({ ...event, backfill: true }) + '\n');
            }

            // Step 4: Send sentinel
            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
          } catch (err) {
            log.error({ err }, 'Failed to query activity_log for backfill');
            // Send sentinel even on error so client knows backfill phase is done
            await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');
          }

          // Step 5: Flush buffered live events that arrived during backfill
          backfillComplete = true;
          for (const buffered of liveBuffer) {
            await s.write(JSON.stringify(buffered) + '\n');
          }
          liveBuffer.length = 0;
        }

        // Step 6: From here, live events are written directly by the listener above
        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            resolve();
          });
        });
      });
    }

    // --- REST mode: Query activity_log table ---
    let activities: ActivityEvent[];

    if (sinceId) {
      // Cursor-based pagination: return events after the given ULID
      const rows = ctx.db.findActivityLogSinceFiltered(sinceId, limit, dbFilters);
      activities = resolveActivityRows(rows);
    } else {
      // No cursor: return most recent events
      const rows = ctx.db.findActivityLogRecent(limit, dbFilters);
      activities = resolveActivityRows(rows);
    }

    // Apply multi-type filter in-memory when multiple types requested
    if (typeFilter && typeFilter.size > 1) {
      activities = activities.filter((e) => typeFilter.has(e.type));
    }

    return c.json({ activities });
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

    const actionRuns = ctx.db.getActionRunsByApprovalStatus(approvalStatus, 20).map((run) => ({
      ...run,
      recovery_strategy: run.recovery_strategy === 'unknown' ? null : run.recovery_strategy,
    }));
    return c.json({ actionRuns });
  });

  api.post('/action-runs/:id/approve', async (c) => {
    const id = c.req.param('id');
    const actionRun = ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    ctx.db.updateActionRunApproval(id, 'approved', actionRun.approval_tool ?? undefined);
    await eventBus.emit('recovery:approval-resolved', {
      actionRunId: id,
      approved: true,
      projectId: actionRun.project_id,
    });

    return c.json({ success: true, actionRunId: id, status: 'approved' });
  });

  api.post('/action-runs/:id/reject', async (c) => {
    const id = c.req.param('id');
    const actionRun = ctx.db.findActionRunPendingApproval(id);
    if (!actionRun) {
      return c.json({ error: 'NOT_FOUND', message: 'Action run not found or not pending' }, 404);
    }

    ctx.db.updateActionRunApproval(id, 'rejected', actionRun.approval_tool ?? undefined);
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
    const services: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }> = {};

    // Build self-contained services for projects with an active container.
    // Uses Docker DNS (container name) + container port — no @docker dependency.
    // Includes 'building' status to keep routes alive during blue-green deploys.
    const allProjects = ctx.db
      .listProjects()
      .filter((p) => p.status === 'running' || (p.status === 'building' && p.container_id));
    for (const project of allProjects) {
      const internalPort = project.container_port ?? project.assigned_port;
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
    for (const [projectId, { projectName, domains }] of projectDomains) {
      const svcName = `svc-${projectName}`;
      if (!services[svcName]) {
        const project = ctx.db.getProject(projectId);
        const internalPort = project?.container_port ?? project?.assigned_port;
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

      if (
        (project.visibility === 'quick-share' || project.visibility === 'shared') &&
        project.public_url
      ) {
        try {
          const host = new URL(project.public_url).hostname;
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

  api.route('/', createDeployStreamRoutes(ctx));
  api.route('/', createProjectRoutes(ctx));
  api.route('/', createSystemRoutes(ctx));
  api.route('/', createAiUsageRoutes(ctx));
  api.route('/', createApprovalRoutes(ctx));
  api.route('/ops', createOpsRoutes(ctx));
  api.route('/', createOverviewRoutes(ctx));

  return api;
}
