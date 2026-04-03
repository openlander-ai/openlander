import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { updateConfig } from '../../config/index.js';

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

      return c.json({ incidents: incidents.slice(0, limit) });
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
      return c.json({ incident, events });
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
      return c.json({ events });
    } catch {
      return c.json({ error: 'Failed to fetch incident events' }, 500);
    }
  });

  // --- OpsAgent Config ---

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

  // --- Unified Activity Feed ---

  api.get('/activity', (c) => {
    try {
      const projectId = c.req.query('projectId');
      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
      const severity = c.req.query('severity');
      const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
      const before = c.req.query('before');

      const projects = ctx.db.listProjects();
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
      const activities: ActivityItem[] = [];

      // Incidents
      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const incidents = projectId
          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());

        for (const inc of incidents) {
          if (types.length === 0 || types.includes('incident')) {
            activities.push({
              id: inc.id,
              timestamp: new Date(inc.created_at).toISOString(),
              type: 'incident',
              severity: inc.severity as ActivityItem['severity'],
              projectId: inc.project_id,
              projectName: projectMap.get(inc.project_id) ?? inc.project_id,
              title: inc.root_cause ?? 'Incident detected',
              description: inc.diagnosis ?? '',
              status: inc.status === 'resolved' ? 'resolved' : 'active',
              incidentId: inc.id,
            });
          }
          if (types.length === 0 || types.includes('alert')) {
            const events = ctx.db.listOpsIncidentEvents(inc.id);
            for (const ev of events.filter((e) => e.event_type === 'cascade_detected')) {
              let cascadeGroup: string[] = [];
              try {
                cascadeGroup =
                  (JSON.parse(ev.metadata ?? '{}') as { affected_project_ids?: string[] })
                    .affected_project_ids ?? [];
              } catch {
                /* ignore */
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
        const runs = projectId
          ? ctx.db.getActionRunsByProject(projectId, 100)
          : ctx.db.getActionRunsByApprovalStatus('pending', 50);
        for (const run of runs) {
          if (run.trigger_source !== 'auto_recovery' && run.status !== 'pending_approval') continue;
          const itemType: ActivityItem['type'] =
            run.status === 'pending_approval' ? 'approval' : 'recovery';
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
                  : run.status === 'pending_approval'
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
      const page = sorted.slice(0, limit);
      return c.json({
        activities: page,
        nextCursor: page.length === limit ? (page[page.length - 1]?.timestamp ?? null) : null,
      });
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
          status: p.status ?? 'unknown',
        })),
        ...services.map((s) => ({
          id: s.id,
          type: 'service' as const,
          name: s.name,
          status: s.status ?? 'unknown',
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
