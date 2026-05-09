import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';

function createApp() {
  const app = new Hono();
  app.route('/api', createOpsRoutes({ db: {} } as unknown as AppContext));
  return app;
}

describe('ops automation routes', () => {
  it.each([
    ['GET', '/api/automation/defaults'],
    ['GET', '/api/projects/proj-1/automation'],
    ['PUT', '/api/projects/proj-1/automation'],
    ['DELETE', '/api/projects/proj-1/automation'],
  ] as const)('%s %s is disabled in OpenLander 0.1', async (method, path) => {
    const res = await createApp().request(path, { method });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: 'FEATURE_DISABLED' });
  });
});
