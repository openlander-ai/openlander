import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { WebhookManager } from '../../webhook/index.js';
import { eventBus } from '../../events/index.js';

export function createWebhookRoutes(ctx: AppContext): Hono {
  const api = new Hono();
  const manager = new WebhookManager(ctx.pipeline, ctx.db, eventBus);

  api.post('/webhooks/:projectId/github', async (c) => {
    const projectId = c.req.param('projectId');
    const body = await c.req.text();
    const headers = normalizeHeaders(c.req.raw.headers);
    headers['x-openlander-project-id'] = projectId;
    const result = await manager.handleWebhook('github', headers, body);
    return c.json(result, result.accepted ? 202 : 400);
  });

  api.post('/webhooks/:projectId/gitlab', async (c) => {
    const projectId = c.req.param('projectId');
    const body = await c.req.text();
    const headers = normalizeHeaders(c.req.raw.headers);
    headers['x-openlander-project-id'] = projectId;
    const result = await manager.handleWebhook('gitlab', headers, body);
    return c.json(result, result.accepted ? 202 : 400);
  });

  api.post('/webhooks/:projectId/bitbucket', async (c) => {
    const projectId = c.req.param('projectId');
    const body = await c.req.text();
    const headers = normalizeHeaders(c.req.raw.headers);
    headers['x-openlander-project-id'] = projectId;
    const result = await manager.handleWebhook('bitbucket', headers, body);
    return c.json(result, result.accepted ? 202 : 400);
  });

  return api;
}

function normalizeHeaders(rawHeaders: Headers): Record<string, string> {
  const normalized: Record<string, string> = {};
  rawHeaders.forEach((value, key) => {
    normalized[key.toLowerCase()] = value;
  });
  return normalized;
}
