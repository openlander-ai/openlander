import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import type { OpsIncidentEventRow, OpsIncidentRow, ProjectRow } from '../../db/types.js';
import { createModuleLogger } from '../../lib/logger.js';
import { aiOpsDisabledResponse } from './ai-ops-disabled.js';

const log = createModuleLogger('ops-routes');

/**
 * Per-request memoizer for `ctx.db.listProjects()`. Each handler invocation
 * creates a fresh memoizer; the first call hits the DB and subsequent calls
 * within the same request reuse the cached array.
 *
 * Day 14 (Codex Day 9 N+1 audit): the unified activity feed and several
 * sibling endpoints used to invoke `listProjects()` once per code path,
 * which under SSE follow-mode produced O(subscribers x cycles) DB calls.
 * Memoizing per request removes the duplication without introducing any
 * cross-request cache (each SSE flush still gets fresh data).
 */
function makeProjectsMemo(ctx: AppContext): () => Promise<ProjectRow[]> {
  let cache: Promise<ProjectRow[]> | undefined;
  return async () => {
    if (cache === undefined) {
      cache = ctx.db.listProjects();
    }
    return await cache;
  };
}

interface ActivityItem {
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
    | 'recovery:degraded'
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
  triggerType?: string;
  triggerDetails?: string;
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
}

interface ParsedIncidentTrigger {
  triggerType?: string;
  triggerDetails?: string;
}

interface IncidentEventMetadata {
  trigger_type?: string;
  trigger_details?: string;
  affected_project_ids?: string[];
}

function groupEventsByIncidentId(
  events: OpsIncidentEventRow[],
): Map<string, OpsIncidentEventRow[]> {
  const grouped = new Map<string, OpsIncidentEventRow[]>();
  for (const event of events) {
    const existing = grouped.get(event.incident_id);
    if (existing) {
      existing.push(event);
      continue;
    }
    grouped.set(event.incident_id, [event]);
  }
  return grouped;
}

function parseEventMetadata(metadata: string | null): IncidentEventMetadata | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as IncidentEventMetadata;
  } catch (err) {
    log.warn({ err }, 'Failed to parse deploy lock');
    return null;
  }
}

function parseTriggerFromText(text: string | null | undefined): ParsedIncidentTrigger {
  if (!text) return {};
  const cleaned = text
    .replace(/^Incident detected:\s*/i, '')
    .replace(/^Recurring event:\s*/i, '')
    .trim();
  if (!cleaned) return {};
  const [typePart, ...detailsParts] = cleaned.split(' — ');
  const triggerType = typePart?.trim();
  if (!triggerType) return {};
  const details = detailsParts.join(' — ').trim();
  return {
    triggerType,
    triggerDetails: details || undefined,
  };
}

function extractIncidentTrigger(
  incident: OpsIncidentRow,
  events: OpsIncidentEventRow[],
): ParsedIncidentTrigger {
  const detected = events.find((event) => event.event_type === 'detected');
  if (detected) {
    const metadata = parseEventMetadata(detected.metadata);
    if (metadata?.trigger_type) {
      return {
        triggerType: metadata.trigger_type,
        triggerDetails: metadata.trigger_details,
      };
    }
    const detectedTrigger = parseTriggerFromText(detected.description);
    if (detectedTrigger.triggerType) return detectedTrigger;
  }
  return parseTriggerFromText(incident.root_cause);
}

function mapIncidentResponse(
  incident: OpsIncidentRow,
  events: OpsIncidentEventRow[],
  projectName?: string,
) {
  const trigger = extractIncidentTrigger(incident, events);
  const title = incident.root_cause ?? 'Incident detected';
  return {
    ...incident,
    projectName,
    title,
    triggerType: trigger.triggerType,
    triggerDetails: trigger.triggerDetails,
  };
}

function mapIncidentEventResponse(event: OpsIncidentEventRow) {
  return {
    ...event,
    type: event.event_type,
    message: event.description,
  };
}

export function createOpsRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // --- Incidents ---

  api.get('/incidents', async (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const search = c.req.query('search');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 500);

    try {
      let incidents;
      if (projectId) {
        incidents = await ctx.db.listOpsIncidentsByProject(projectId, limit);
      } else {
        const from = fromParam
          ? Math.max(0, parseInt(fromParam, 10) || 0)
          : Date.now() - 7 * 24 * 60 * 60 * 1000;
        const to = toParam ? Math.max(0, parseInt(toParam, 10) || 0) : Date.now();
        incidents = await ctx.db.listOpsIncidentsByDateRange(from, to, search);
      }

      if (status) {
        incidents = incidents.filter((i) => i.status === status);
      }

      const page = incidents.slice(0, limit);
      const events = await ctx.db.listOpsIncidentEventsByIncidentIds(
        page.map((incident) => incident.id),
      );
      const eventsByIncidentId = groupEventsByIncidentId(events);

      const getProjects = makeProjectsMemo(ctx);
      const projects = await getProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));

      return c.json({
        incidents: page.map((incident) =>
          mapIncidentResponse(
            incident,
            eventsByIncidentId.get(incident.id) ?? [],
            projectMap.get(incident.project_id) ?? incident.project_id,
          ),
        ),
      });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch incidents');
      return c.json({ error: 'Failed to fetch incidents' }, 500);
    }
  });

  api.get('/incidents/:id', async (c) => {
    const id = c.req.param('id');

    try {
      const incident = await ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const project = await ctx.db.getProject(incident.project_id);
      const projectName = project?.name ?? incident.project_id;

      const events = await ctx.db.listOpsIncidentEvents(id);
      return c.json({
        incident: mapIncidentResponse(incident, events, projectName),
        events: events.map(mapIncidentEventResponse),
      });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch incident');
      return c.json({ error: 'Failed to fetch incident' }, 500);
    }
  });

  api.get('/incidents/:id/events', async (c) => {
    const id = c.req.param('id');

    try {
      const incident = await ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const events = await ctx.db.listOpsIncidentEvents(id);
      return c.json({ events: events.map(mapIncidentEventResponse) });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch incident events');
      return c.json({ error: 'Failed to fetch incident events' }, 500);
    }
  });

  // --- OpsAgent Config ---

  api.get('/agent/active', aiOpsDisabledResponse);
  api.get('/config', aiOpsDisabledResponse);
  api.put('/config', aiOpsDisabledResponse);

  // --- Digest ---

  api.get('/digest/latest', aiOpsDisabledResponse);
  api.post('/digest/trigger', aiOpsDisabledResponse);

  // --- Circuit Breaker ---

  api.get('/circuit-breaker/:projectId', async (c) => {
    const projectId = c.req.param('projectId');

    try {
      const state = await ctx.db.getCircuitBreakerState(projectId);
      return c.json({ state });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch circuit breaker state');
      return c.json({ state: null });
    }
  });

  api.post('/circuit-breaker/:projectId/reset', async (c) => {
    const projectId = c.req.param('projectId');

    try {
      await ctx.db.resetCircuitBreaker(projectId);
      return c.json({ reset: true });
    } catch (err) {
      log.warn({ err }, 'Failed to reset circuit breaker');
      return c.json({ reset: false }, 500);
    }
  });

  // --- Health ---

  api.get('/health', (c) => {
    return c.json({
      status: 'ok',
      queue: 0,
      running: ctx.opsAgent !== undefined,
    });
  });

  // --- Global Circuit Breakers ---

  api.get('/circuit-breakers', async (c) => {
    try {
      const allBreakers = await ctx.db.listAllCircuitBreakers();
      const getProjects = makeProjectsMemo(ctx);
      const projects = await getProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const breakers = allBreakers
        .map((b) => ({
          projectId: b.project_id,
          projectName: projectMap.get(b.project_id) ?? b.project_id,
          state: b.state,
          failureCount: b.failure_count,
          lastFailureAt: b.last_failure_at,
          openedAt: b.opened_at,
          resetAt: b.reset_at,
        }))
        .sort((a, b) => {
          const order: Record<string, number> = { open: 0, half_open: 1, closed: 2 };
          return (order[a.state] ?? 2) - (order[b.state] ?? 2);
        });
      return c.json({ breakers });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Automation Policy ---

  api.get('/automation/defaults', aiOpsDisabledResponse);
  api.get('/projects/:projectId/automation', aiOpsDisabledResponse);
  api.put('/projects/:projectId/automation', aiOpsDisabledResponse);
  api.delete('/projects/:projectId/automation', aiOpsDisabledResponse);

  // --- Unified Activity Feed ---

  api.get('/activity', async (c) => {
    const isFollow = c.req.query('follow') === 'true';

    // Per-flush memoizer — each fetchActivities call gets its own fresh
    // listProjects() result. In SSE follow mode this means O(1) DB call
    // per cycle even if future code paths inside fetchActivities add more
    // project lookups. Cache lives only for the duration of one fetch,
    // so concurrent SSE clients still see freshly committed projects on
    // each 2-second flush.
    const fetchActivities = async (sinceParam?: string) => {
      const getProjects = makeProjectsMemo(ctx);
      const projectId = c.req.query('projectId');
      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
      const severity = c.req.query('severity');
      const limitParam = c.req.query('limit');
      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
      const before = c.req.query('before');
      const since = sinceParam || c.req.query('since');
      const fromParam = c.req.query('from');
      const toParam = c.req.query('to');

      const projects = await getProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const from = fromParam ? Number(fromParam) : Date.now() - 7 * 24 * 60 * 60 * 1000;
        const to = toParam ? Number(toParam) : Date.now();
        const incidents = projectId
          ? await ctx.db.listOpsIncidentsByProject(projectId, 100)
          : await ctx.db.listOpsIncidentsByDateRange(from, to);
        const eventsByIncidentId = groupEventsByIncidentId(
          await ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
        );

        for (const inc of incidents) {
          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];
          const trigger = extractIncidentTrigger(inc, incidentEvents);

          if (types.length === 0 || types.includes('incident')) {
            activities.push({
              id: inc.id,
              timestamp: new Date(inc.created_at).toISOString(),
              type: 'incident',
              severity: inc.severity,
              projectId: inc.project_id,
              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
              title: inc.root_cause ?? 'Incident detected',
              description: inc.diagnosis ?? '',
              status: inc.status === 'resolved' ? 'resolved' : 'active',
              incidentId: inc.id,
              triggerType: trigger.triggerType,
              triggerDetails: trigger.triggerDetails,
            });
          }
          if (types.length === 0 || types.includes('alert')) {
            for (const ev of incidentEvents.filter(
              (e) => (e.event_type as string) === 'cascade_detected',
            )) {
              let cascadeGroup: string[] = [];
              try {
                cascadeGroup = parseEventMetadata(ev.metadata)?.affected_project_ids ?? [];
              } catch (err) {
                log.warn({ err }, 'Failed to parse SSE activity line');
              }
              activities.push({
                id: ev.id,
                timestamp: new Date(ev.created_at).toISOString(),
                type: 'alert',
                severity: 'warning',
                projectId: inc.project_id,
                projectName: projectMap.get(inc.project_id) ?? inc.project_id,
                title: 'Cascade detected',
                description: ev.description,
                status: 'active',
                incidentId: inc.id,
                cascadeGroup,
              });
            }
          }
        }
      }

      // Action runs
      if (types.length === 0 || types.includes('recovery') || types.includes('approval')) {
        const candidateRuns = projectId
          ? await ctx.db.getActionRunsByProject(projectId, 100)
          : await ctx.db.getRecentActionRuns(200);
        const runs = candidateRuns;
        for (const run of runs) {
          if (
            run.trigger_source !== 'auto_recovery' &&
            (run.status as string) !== 'pending_approval'
          )
            continue;
          const itemType: ActivityItem['type'] =
            (run.status as string) === 'pending_approval' ? 'approval' : 'recovery';
          if (types.length > 0 && !types.includes(itemType)) continue;
          activities.push({
            id: run.id,
            timestamp: run.created_at,
            type: itemType,
            severity: run.status === 'failed' ? 'warning' : 'info',
            projectId: run.project_id,
            projectName: projectMap.get(run.project_id) ?? run.project_id,
            title:
              itemType === 'approval'
                ? `Approval required: ${run.approval_tool ?? 'action'}`
                : `Auto-recovery ${run.status}`,
            description: run.error_message ?? run.plan ?? '',
            status:
              run.status === 'succeeded'
                ? 'resolved'
                : run.status === 'failed'
                  ? 'failed'
                  : (run.status as string) === 'pending_approval'
                    ? 'pending'
                    : 'active',
            actionRunId: run.id,
            correlationId: run.correlation_id ?? undefined,
          });
        }
      }

      // AI Events
      if (types.length === 0 || types.includes('ai:invoked') || types.includes('ai:completed')) {
        const aiTypes = ['ai:invoked', 'ai:completed'];
        for (const aiType of aiTypes) {
          if (types.length > 0 && !types.includes(aiType)) continue;
          const aiRows = await ctx.db.findActivityLogRecent(200, {
            project_id: projectId,
            activity_type: aiType,
          });
          for (const row of aiRows) {
            let metadata: Record<string, unknown> = {};
            try {
              metadata = JSON.parse(row.metadata) as Record<string, unknown>;
            } catch (err) {
              log.warn({ err }, 'Failed to write SSE heartbeat');
            }

            activities.push({
              id: row.id,
              timestamp: row.created_at,
              type: row.activity_type as ActivityItem['type'],
              severity: row.severity as ActivityItem['severity'],
              projectId: row.project_id,
              projectName: projectMap.get(row.project_id) ?? row.project_id,
              title: row.title,
              description: row.description,
              status: row.status as ActivityItem['status'],
              correlationId: row.correlation_id ?? undefined,
              aiMetadata: metadata.aiMetadata as ActivityItem['aiMetadata'],
            });
          }
        }
      }

      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (severity) sorted = sorted.filter((a) => a.severity === severity);
      if (before) sorted = sorted.filter((a) => a.timestamp < before);
      if (since) sorted = sorted.filter((a) => a.id > since);
      const page = sorted.slice(0, limit);
      return {
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    };

    if (isFollow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');
        let lastReportedId = c.req.query('since') || '';
        let flushInProgress = false;

        const sendUpdates = async (): Promise<void> => {
          if (flushInProgress) return;
          flushInProgress = true;
          try {
            const page = await fetchActivities(lastReportedId || undefined);
            if (page.activities.length > 0) {
              const forward = [...page.activities].reverse();
              for (const act of forward) {
                await s.write(JSON.stringify(act) + '\n');
              }
              const lastActivity = forward[forward.length - 1];
              if (lastActivity) {
                lastReportedId = lastActivity.id;
              }
            }
          } catch (err) {
            console.error('Unified feed streaming error:', err);
          } finally {
            flushInProgress = false;
          }
        };

        // Initial backfill
        await sendUpdates();
        await s.write(JSON.stringify({ type: 'backfill-complete' }) + '\n');

        const interval = setInterval(() => {
          void sendUpdates();
        }, 2000);

        await new Promise<void>((resolve) => {
          s.onAbort(() => {
            clearInterval(interval);
            resolve();
          });
        });
      });
    }

    try {
      const page = await fetchActivities();
      return c.json(page);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Postmortems ---

  api.get('/postmortems', aiOpsDisabledResponse);
  api.get('/postmortems/:projectId', aiOpsDisabledResponse);

  // --- Deployment Patterns ---

  api.get('/patterns', async (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

    try {
      const all = await ctx.db.listAllDeploymentPatterns();
      const page = all.slice(offset, offset + limit);
      return c.json({ patterns: page, total: all.length });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch deployment patterns');
      return c.json({ error: 'Failed to fetch deployment patterns' }, 500);
    }
  });

  api.get('/patterns/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

    try {
      const all = await ctx.db.findDeploymentPatternsByProject(projectId);
      const sorted = [...all].sort((a, b) =>
        (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''),
      );
      const page = sorted.slice(offset, offset + limit);
      return c.json({ patterns: page, total: all.length });
    } catch (err) {
      log.warn({ err }, 'Failed to fetch deployment patterns');
      return c.json({ error: 'Failed to fetch deployment patterns' }, 500);
    }
  });

  // --- Dependency Graph ---

  api.get('/dependencies', async (c) => {
    try {
      const getProjects = makeProjectsMemo(ctx);
      const [projects, services, dependencies] = await Promise.all([
        getProjects(),
        ctx.db.listServices(),
        ctx.db.findAllProjectDependencies(),
      ]);
      const deployables = await Promise.all(
        projects.map((project) => ctx.db.getDeployableForProject(project.id)),
      );
      const deployableByProjectId = new Map(
        projects.map((project, index) => [project.id, deployables[index]]),
      );

      const nodes: Array<{
        id: string;
        type: 'project' | 'service';
        name: string;
        status: string;
      }> = [
        ...projects.map((p) => ({
          id: p.id,
          type: 'project' as const,
          name: p.name,
          // Fix 3: status is a deployable field — canonical-first ?? legacy fallback.
          status: deployableByProjectId.get(p.id)?.status ?? p.status ?? '',
        })),
        ...services.map((s) => ({
          id: s.id,
          type: 'service' as const,
          name: s.name,
          status: s.status ?? '',
        })),
      ];

      const edges = dependencies
        .map((dep) => ({
          source: dep.source_service_id,
          target: dep.target_service_id ?? '',
          dependencyType: dep.dependency_type,
        }))
        .filter((e) => e.target !== '');

      return c.json({ nodes, edges });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  return api;
}
