import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { createWebhookRoutes } from '../../../src/web/api/webhook-routes.js';

describe('git provider webhook routes', () => {
  it.each(['github', 'gitlab', 'bitbucket'] as const)(
    'returns FEATURE_DISABLED for %s push webhooks',
    async (source) => {
      const app = new Hono();
      app.route('/api', createWebhookRoutes({} as AppContext));

      const res = await app.request(`/api/webhooks/project-1/${source}`, {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(410);
      await expect(res.json()).resolves.toMatchObject({
        error: 'FEATURE_DISABLED',
        code: 'FEATURE_DISABLED',
      });
    },
  );
});
