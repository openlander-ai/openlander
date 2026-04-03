import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { updateConfig } from '../../config/index.js';

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

  return api;
}
