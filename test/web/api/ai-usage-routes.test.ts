import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { createAiUsageRoutes } from '../../../src/web/api/ai-usage-routes.js';

function createApp() {
  const app = new Hono();
  app.route('/api', createAiUsageRoutes({} as AppContext));
  return app;
}

describe('AI Usage Routes disabled in 0.1', () => {
  it.each([
    '/api/usage/summary',
    '/api/usage/recent',
    '/api/ai-usage/summary',
    '/api/ai-usage/recent',
  ])('returns FEATURE_DISABLED for %s', async (path) => {
    const res = await createApp().request(path);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'FEATURE_DISABLED',
      code: 'FEATURE_DISABLED',
    });
  });
});
