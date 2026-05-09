import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { gitWebhooksDisabledResponse } from './git-webhook-disabled.js';

export function createWebhookRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/webhooks/:projectId/github', (c) => gitWebhooksDisabledResponse(c));

  api.post('/webhooks/:projectId/gitlab', (c) => gitWebhooksDisabledResponse(c));

  api.post('/webhooks/:projectId/bitbucket', (c) => gitWebhooksDisabledResponse(c));

  return api;
}
