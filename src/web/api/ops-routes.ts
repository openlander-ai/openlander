import { Hono } from 'hono';

import type { AppContext } from '../../app.js';

export function createOpsRoutes(ctx: AppContext): Hono {
  const api = new Hono();
  void ctx;

  api.get('/incidents', (c) => {
    return c.json({ incidents: [] });
  });

  api.get('/incidents/:id', (c) => {
    return c.json({ error: 'NOT_IMPLEMENTED' }, 501);
  });

  api.get('/incidents/:id/events', (c) => {
    return c.json({ events: [] });
  });

  api.get('/config', (c) => {
    return c.json({ config: {} });
  });

  api.put('/config', (c) => {
    return c.json({ config: {} });
  });

  api.get('/digest/latest', (c) => {
    return c.json({ digest: null });
  });

  api.post('/digest/trigger', (c) => {
    return c.json({ triggered: true });
  });

  api.get('/circuit-breaker/:projectId', (c) => {
    return c.json({ state: null });
  });

  api.post('/circuit-breaker/:projectId/reset', (c) => {
    return c.json({ reset: true });
  });

  api.get('/health', (c) => {
    return c.json({ status: 'ok', queue: 0 });
  });

  return api;
}
