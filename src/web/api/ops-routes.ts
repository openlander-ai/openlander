import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import type { OpsIncidentEventRow, OpsIncidentRow } from '../../db/types.js';
import { updateConfig } from '../../config/index.js';
import { resolveAutomationPolicy, isAutopilot } from '../../monitor/ops-config-resolver.js';
import { DEFAULT_OPS_CONFIG, DEFAULT_RECOVERY_AUTOMATION } from '../../monitor/ops-types.js';

interface ActivityItem {
  id: string;
  timestamp: string;
  type: 'incident' | 'recovery' | 'approval' | 'circuit_breaker' | 'cleanup' | 'alert';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status: 'active' | 'resolved' | 'pending' | 'failed';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  triggerType?: string;
  triggerDetails?: string;
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
  } catch {
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

function mapIncidentResponse(incident: OpsIncidentRow, events: OpsIncidentEventRow[]) {
  const trigger = extractIncidentTrigger(incident, events);
  const title = incident.root_cause ?? 'Incident detected';
  return {
    ...incident,
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

  api.get('/incidents', (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const limit = Number(c.req.query('limit') ?? 50);

    try {
      let incidents;
      if (projectId) {
        incidents = ctx.db.listOpsIncidentsByProject(projectId, limit);
      } else {
        const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
        incidents = ctx.db.listOpsIncidentsByDateRange(from, Date.now());
      }

      if (status) {
        incidents = incidents.filter((i) => i.status === status);
      }

      const page = incidents.slice(0, limit);
      const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
      const eventsByIncidentId = groupEventsByIncidentId(events);
      return c.json({
        incidents: page.map((incident) =>
          mapIncidentResponse(incident, eventsByIncidentId.get(incident.id) ?? []),
        ),
      });
    } catch {
      return c.json({ error: 'Failed to fetch incidents' }, 500);
    }
  });

  api.get('/incidents/:id', (c) => {
    const id = c.req.param('id');

    try {
      const incident = ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const events = ctx.db.listOpsIncidentEvents(id);
      return c.json({
        incident: mapIncidentResponse(incident, events),
        events: events.map(mapIncidentEventResponse),
      });
    } catch {
      return c.json({ error: 'Failed to fetch incident' }, 500);
    }
  });

  api.get('/incidents/:id/events', (c) => {
    const id = c.req.param('id');

    try {
      const incident = ctx.db.getOpsIncident(id);
      if (!incident) {
        return c.json({ error: 'Incident not found' }, 404);
      }

      const events = ctx.db.listOpsIncidentEvents(id);
      return c.json({ events: events.map(mapIncidentEventResponse) });
    } catch {
      return c.json({ error: 'Failed to fetch incident events' }, 500);
    }
  });

  // --- OpsAgent Config ---

  api.get('/agent/active', (c) => {
    try {
      const projects = ctx.db.listProjects();
      const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
      const activeRuns = projects
        .flatMap((project) => ctx.db.getRunningActionRuns(project.id))
        .sort((a, b) => b.started_at.localeCompare(a.started_at));
      const activeRun = activeRuns[0];

      if (!activeRun) {
        return c.json({ isActive: false });
      }

      const approvalPending =
        activeRun.approval_status === 'pending' ||
        (activeRun.status as string) === 'pending_approval';
      const currentStep = approvalPending
        ? 'Awaiting approval'
        : typeof activeRun.current_step === 'number' && typeof activeRun.total_steps === 'number'
          ? `Executing step ${String(activeRun.current_step)} / ${String(activeRun.total_steps)}`
          : undefined;

      return c.json({
        isActive: true,
        projectId: activeRun.project_id,
        projectName: projectNameById.get(activeRun.project_id) ?? activeRun.project_id,
        currentStep,
        currentStepNumber: activeRun.current_step ?? undefined,
        totalSteps: activeRun.total_steps ?? undefined,
        startedAt: activeRun.started_at,
        lastUpdatedAt: activeRun.updated_at ?? activeRun.created_at,
      });
    } catch {
      return c.json({ isActive: false });
    }
  });

  api.get('/config', (c) => {
    const config = ctx.opsAgent?.getConfig() ?? {};
    return c.json({ config });
  });

  api.put('/config', async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      ctx.opsAgent?.reloadConfig(body);
      updateConfig({ ops: body });
      return c.json({ config: ctx.opsAgent?.getConfig() ?? {} });
    } catch {
      return c.json({ error: 'Invalid config' }, 400);
    }
  });

  // --- Digest ---

  api.get('/digest/latest', (c) => {
    const digest = ctx.opsAgent?.getDigest() ?? null;
    return c.json({ digest });
  });

  api.post('/digest/trigger', async (c) => {
    try {
      await ctx.opsAgent?.generateDigest();
      return c.json({ triggered: true });
    } catch (err) {
      return c.json({ triggered: false, error: String(err) }, 500);
    }
  });

  // --- Circuit Breaker ---

  api.get('/circuit-breaker/:projectId', (c) => {
    const projectId = c.req.param('projectId');

    try {
      const state = ctx.db.getCircuitBreakerState(projectId);
      return c.json({ state });
    } catch {
      return c.json({ state: null });
    }
  });

  api.post('/circuit-breaker/:projectId/reset', (c) => {
    const projectId = c.req.param('projectId');

    try {
      ctx.db.resetCircuitBreaker(projectId);
      return c.json({ reset: true });
    } catch {
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

  api.get('/circuit-breakers', (c) => {
    try {
      const allBreakers = ctx.db.listAllCircuitBreakers();
      const projects = ctx.db.listProjects();
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

  api.get('/automation/defaults', (c) => {
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const policy = resolveAutomationPolicy(config);
    return c.json({
      defaults: DEFAULT_RECOVERY_AUTOMATION,
      effective: policy,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.get('/projects/:projectId/automation', (c) => {
    const projectId = c.req.param('projectId');
    const project = ctx.db.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const override = ctx.db.getProjectOpsOverride(projectId);
    const policy = resolveAutomationPolicy(config, override);
    return c.json({
      effective: policy,
      overrides: override?.automation ?? null,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.put('/projects/:projectId/automation', async (c) => {
    const projectId = c.req.param('projectId');
    const project = ctx.db.getProject(projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }
    let body: { automation?: Record<string, string> };
    try {
      body = await c.req.json<{ automation?: Record<string, string> }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);
    const validModes = new Set(['auto', 'confirm']);
    for (const [step, mode] of Object.entries(body.automation ?? {})) {
      if (!validSteps.has(step)) {
        return c.json({ error: `Invalid step: ${step}` }, 400);
      }
      if (!validModes.has(mode)) {
        return c.json({ error: `Invalid mode: ${mode}` }, 400);
      }
    }
    const typed = body.automation as
      | Partial<Record<'restart' | 'diagnosis' | 'apply_fixes' | 'rollback', 'auto' | 'confirm'>>
      | undefined;
    const existing = ctx.db.getProjectOpsOverride(projectId);
    const merged = { ...existing?.automation, ...typed };
    ctx.db.setProjectOpsOverride(projectId, { automation: merged });
    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
    const override = ctx.db.getProjectOpsOverride(projectId);
    const policy = resolveAutomationPolicy(config, override);
    return c.json({
      effective: policy,
      overrides: override?.automation ?? null,
      isAutopilot: policy ? isAutopilot(policy) : false,
    });
  });

  api.delete('/projects/:projectId/automation', (c) => {
    const projectId = c.req.param('projectId');
    ctx.db.deleteProjectOpsOverride(projectId);
    return c.json({ deleted: true });
  });

  // --- Unified Activity Feed ---

  api.get('/activity', (c) => {
    const isFollow = c.req.query('follow') === 'true';

    const fetchActivities = (sinceParam?: string) => {
      const projectId = c.req.query('projectId');
      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
      const severity = c.req.query('severity');
      const limitParam = c.req.query('limit');
      const limit = isFollow ? 100 : Math.min(parseInt(limitParam ?? '50', 10), 200);
      const before = c.req.query('before');
      const since = sinceParam || c.req.query('since');

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const incidents = projectId
          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
        const eventsByIncidentId = groupEventsByIncidentId(
          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
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
              } catch {
                // ignore parsing error
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
          ? ctx.db.getActionRunsByProject(projectId, 100)
          : projects.flatMap((project) => ctx.db.getActionRunsByProject(project.id, 20));
        const runs = candidateRuns
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 200);
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

      let sorted = activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (severity) sorted = sorted.filter((a) => a.severity === severity);
      if (before) sorted = sorted.filter((a) => a.timestamp < before);
      if (since) sorted = sorted.filter((a) => a.timestamp > since);
      const page = sorted.slice(0, limit);
      return {
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
      };
    };

    if (isFollow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');
        let lastReportedTime = c.req.query('since') || new Date(Date.now() - 60000).toISOString();
        let flushInProgress = false;

        const sendUpdates = async (): Promise<void> => {
          if (flushInProgress) return;
          flushInProgress = true;
          try {
            const page = fetchActivities(lastReportedTime);
            if (page.activities.length > 0) {
              const forward = [...page.activities].reverse();
              for (const act of forward) {
                await s.write(JSON.stringify(act) + '\n');
              }
              const lastActivity = forward[forward.length - 1];
              if (lastActivity) {
                lastReportedTime = lastActivity.timestamp;
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
      const page = fetchActivities();
      return c.json(page);
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // --- Dependency Graph ---

  api.get('/dependencies', (c) => {
    try {
      const projects = ctx.db.listProjects();
      const services = ctx.db.listServices();
      const dependencies = ctx.db.findAllProjectDependencies();

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
          status: p.status,
        })),
        ...services.map((s) => ({
          id: s.id,
          type: 'service' as const,
          name: s.name,
          status: s.status,
        })),
      ];

      const edges = dependencies
        .map((dep) => ({
          source: dep.source_project_id,
          target: dep.target_project_id ?? dep.target_service_id ?? '',
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
