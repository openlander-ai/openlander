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
  id: string;
  timestamp: string;
  type:
    | 'incident'
    | 'recovery'
    | 'approval'
    | 'circuit_breaker'
    | 'cleanup'
    | 'alert'
    | 'ai_diagnosis'
    | 'ai:invoked'
    | 'ai:completed'
    | 'recovery:blocked'
    | 'recovery:stopped'
    | 'recovery:started';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status:
    | 'active'
    | 'resolved'
    | 'pending'
    | 'failed'
    | 'ai-running'
    | 'ai-completed'
    | 'recovery-blocked'
    | 'recovery-stopped'
    | 'recovering';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
  rawType: EventType;
  // Backward-compatibility aliases for legacy consumers of /api/activity
  project: string;
  user: string;
  detail?: string;
  time: string;
  reason?: string;
}

const activityBuffer: ActivityEvent[] = [];
const MAX_ACTIVITY = 100;

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

function formatEventName(eventType: string): string {
  return eventType.replace(/[:_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveProjectIdFromEvent<T extends EventType>(
  ctx: AppContext,
  eventType: T,
  payload: EventPayload[T],
): string | undefined {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    const projectId = alertPayload.alert.details.projectId;
    return typeof projectId === 'string' ? projectId : undefined;
  }

  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    if (approvalPayload.projectId) return approvalPayload.projectId;
    const statuses: Array<'pending' | 'approved' | 'rejected'> = [
      'pending',
      'approved',
      'rejected',
    ];
    for (const status of statuses) {
      const matched = ctx.db
        .getActionRunsByApprovalStatus(status, 200)
        .find((run) => run.id === approvalPayload.actionRunId);
      if (matched) {
        return matched.project_id;
      }
    }
  }

  const projectId = (payload as { projectId?: string }).projectId;
  return typeof projectId === 'string' ? projectId : undefined;
}

function mapActivityType(eventType: EventType): ActivityEvent['type'] {
  if (
    eventType === 'ai:invoked' ||
    eventType === 'ai:completed' ||
    eventType === 'recovery:blocked' ||
    eventType === 'recovery:stopped' ||
    eventType === 'recovery:started'
  ) {
    return eventType;
  }
  if (eventType === 'recovery:approval-needed' || eventType === 'recovery:approval-resolved') {
    return 'approval';
  }
  if (
    eventType === 'recovery:start' ||
    eventType === 'recovery:success' ||
    eventType === 'recovery:failed' ||
    eventType === 'recovery:exhausted'
  ) {
    return 'recovery';
  }
  if (eventType.startsWith('alert:')) {
    return 'alert';
  }
  return 'incident';
}

function mapActivityStatus<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent['status'] {
  if (eventType === 'ai:invoked') return 'ai-running';
  if (eventType === 'ai:completed') {
    const completedPayload = payload as EventPayload['ai:completed'];
    return completedPayload.success ? 'ai-completed' : 'failed';
  }
  if (eventType === 'recovery:blocked') return 'recovery-blocked';
  if (eventType === 'recovery:stopped') return 'recovery-stopped';
  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
  if (eventType === 'recovery:success') return 'resolved';
  if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
  if (eventType === 'recovery:approval-needed') return 'pending';
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return approvalPayload.approved ? 'resolved' : 'failed';
  }
  if (eventType === 'alert:resolved') return 'resolved';
  if (
    eventType === 'deploy:failed' ||
    eventType === 'deploy:crash' ||
    eventType === 'compose:failed' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'failed';
  }
  return 'active';
}

function mapActivitySeverity<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
  status: ActivityEvent['status'],
): ActivityEvent['severity'] {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return alertPayload.alert.severity === 'critical' ? 'critical' : 'warning';
  }
  if (
    eventType === 'deploy:crash' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'critical';
  }
  if (status === 'failed' || status === 'recovery-blocked' || status === 'recovery-stopped') {
    return 'warning';
  }
  if (eventType === 'recovery:approval-needed') {
    return 'warning';
  }
  return 'info';
}

function extractEventDetail<T extends EventType>(eventType: T, payload: EventPayload[T]): string {
  if (eventType === 'deploy:failed') {
    return (payload as EventPayload['deploy:failed']).error;
  }
  if (eventType === 'tunnel:url') {
    return (payload as EventPayload['tunnel:url']).url;
  }
  if (eventType === 'compose:failed') {
    return (payload as EventPayload['compose:failed']).error;
  }
  if (eventType === 'recovery:start') {
    return (payload as EventPayload['recovery:start']).error;
  }
  if (eventType === 'recovery:failed') {
    return (payload as EventPayload['recovery:failed']).error;
  }
  if (eventType === 'recovery:exhausted') {
    return (payload as EventPayload['recovery:exhausted']).lastError;
  }
  if (eventType === 'recovery:blocked') {
    return (payload as EventPayload['recovery:blocked']).reason;
  }
  if (eventType === 'recovery:stopped') {
    return (payload as EventPayload['recovery:stopped']).reason;
  }
  if (eventType === 'recovery:started') {
    return (payload as EventPayload['recovery:started']).trigger;
  }
  if (eventType === 'alert:new') {
    return (payload as EventPayload['alert:new']).alert.message;
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return `${aiPayload.model} ${aiPayload.action}`;
  }
  if (eventType === 'ai:completed') {
    return `${String((payload as EventPayload['ai:completed']).durationMs)}ms`;
  }
  return '';
}

function describeActivityEvent<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): Pick<
  ActivityEvent,
  'title' | 'description' | 'actionRunId' | 'aiMetadata' | 'reason' | 'incidentId'
> {
  if (eventType === 'deploy:failed') {
    const deployPayload = payload as EventPayload['deploy:failed'];
    return {
      title: `Deploy failed (${deployPayload.step})`,
      description: deployPayload.error,
    };
  }
  if (eventType === 'deploy:crash') {
    const crashPayload = payload as EventPayload['deploy:crash'];
    return {
      title: 'Deploy crashed',
      description:
        crashPayload.error ??
        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
    };
  }
  if (eventType === 'compose:failed') {
    return {
      title: 'Compose failed',
      description: (payload as EventPayload['compose:failed']).error,
    };
  }
  if (eventType === 'container:die') {
    const diePayload = payload as EventPayload['container:die'];
    return {
      title: 'Container exited',
      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
    };
  }
  if (eventType === 'container:oom') {
    const oomPayload = payload as EventPayload['container:oom'];
    return {
      title: 'Container out of memory',
      description: oomPayload.containerName,
    };
  }
  if (eventType === 'container:missing') {
    const missingPayload = payload as EventPayload['container:missing'];
    return {
      title: 'Container missing',
      description: missingPayload.suggestion,
    };
  }
  if (eventType === 'monitor:inactive') {
    const monitorPayload = payload as EventPayload['monitor:inactive'];
    return {
      title: 'Project inactive',
      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
    };
  }
  if (eventType === 'health:degraded') {
    const degradedPayload = payload as EventPayload['health:degraded'];
    return {
      title: 'Health degraded',
      description:
        degradedPayload.lastError ??
        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
    };
  }
  if (eventType === 'recovery:start') {
    const recoveryPayload = payload as EventPayload['recovery:start'];
    return {
      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:success') {
    const recoveryPayload = payload as EventPayload['recovery:success'];
    return {
      title: 'Auto-recovery succeeded',
      description:
        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
    };
  }
  if (eventType === 'recovery:failed') {
    const recoveryPayload = payload as EventPayload['recovery:failed'];
    return {
      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:exhausted') {
    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
    return {
      title: 'Auto-recovery exhausted',
      description: recoveryPayload.lastError,
    };
  }
  if (eventType === 'recovery:blocked') {
    const blockedPayload = payload as EventPayload['recovery:blocked'];
    return {
      title: 'Recovery blocked',
      description: blockedPayload.reason,
      reason: blockedPayload.reason,
    };
  }
  if (eventType === 'recovery:stopped') {
    const stoppedPayload = payload as EventPayload['recovery:stopped'];
    return {
      title: 'Recovery stopped',
      description: stoppedPayload.reason,
      reason: stoppedPayload.reason,
    };
  }
  if (eventType === 'recovery:started') {
    const startedPayload = payload as EventPayload['recovery:started'];
    return {
      title: 'Recovery started',
      description: startedPayload.trigger,
    };
  }
  if (eventType === 'recovery:approval-needed') {
    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
    return {
      title: `Approval required: ${approvalPayload.toolName}`,
      description: `Attempt #${String(approvalPayload.attempt)}`,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return {
      title: approvalPayload.approved ? 'Approval approved' : 'Approval rejected',
      description: approvalPayload.actionRunId,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return {
      title: 'AI invoked',
      description: `${aiPayload.model} ${aiPayload.action}`,
      aiMetadata: {
        model: aiPayload.model,
      },
    };
  }
  if (eventType === 'ai:completed') {
    const aiPayload = payload as EventPayload['ai:completed'];
    return {
      title: aiPayload.success ? 'AI completed' : 'AI failed',
      description: `${aiPayload.action} (${String(aiPayload.durationMs)}ms)`,
      aiMetadata: {
        model: aiPayload.model,
        durationMs: aiPayload.durationMs,
        tokensUsed: (aiPayload.inputTokens ?? 0) + (aiPayload.outputTokens ?? 0) || undefined,
      },
    };
  }
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return {
      title: `Alert: ${alertPayload.alert.type}`,
      description: alertPayload.alert.message,
      incidentId:
        typeof alertPayload.alert.details.incidentId === 'string'
          ? alertPayload.alert.details.incidentId
          : undefined,
    };
  }

  return {
    title: formatEventName(eventType),
    description: extractEventDetail(eventType, payload),
  };
}

function buildActivityEvent<T extends EventType>(
  ctx: AppContext,
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent | null {
  const projectId = resolveProjectIdFromEvent(ctx, eventType, payload);
  if (!projectId) return null;

  const project = ctx.db.getProject(projectId);
  const projectName = project?.name ?? projectId;
  const timestamp = new Date().toISOString();
  const type = mapActivityType(eventType);
  const status = mapActivityStatus(eventType, payload);
  const severity = mapActivitySeverity(eventType, payload, status);
  const content = describeActivityEvent(eventType, payload);
  const id = `${eventType}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    timestamp,
    type,
    severity,
    projectId,
    projectName,
    title: content.title,
    description: content.description,
    status,
    incidentId: content.incidentId,
    actionRunId: content.actionRunId,
    correlationId: content.actionRunId,
    aiMetadata: content.aiMetadata,
    rawType: eventType,
    project: projectName,
    user: 'system',
    detail: content.description || undefined,
    time: timestamp,
    reason: content.reason,
  };
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

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
      const activityEvent = buildActivityEvent(ctx, eventType, payload);
      if (!activityEvent) return;

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
    const projectIdFilter = c.req.query('projectId') ?? undefined;
    const typeFilter = parseActivityTypeFilter(c.req.query('types'));
    const severityFilter = parseSeverityFilter(c.req.query('severity'));
    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '20', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 20;

    if (follow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        const unsubscribers: Array<() => void> = [];
        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              const activityEvent = buildActivityEvent(ctx, eventType, payload);
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

    const activities = activityBuffer.filter((activity) =>
      shouldIncludeActivity(activity, {
        projectId: projectIdFilter,
        types: typeFilter,
        severity: severityFilter,
      }),
    );
    return c.json({ activities: activities.slice(-limit) });
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
