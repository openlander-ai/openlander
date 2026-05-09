import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';

function createHarness() {
  const ctx = {
    db: {
      listOpsIncidentsByProject: async () => [],
      listOpsIncidentsByDateRange: async () => [],
      listOpsIncidentEventsByIncidentIds: async () => [],
      listOpsIncidentEvents: async () => [],
      getOpsIncident: async () => undefined,
      getCircuitBreakerState: async () => null,
      resetCircuitBreaker: async () => undefined,
      listAllCircuitBreakers: async () => [],
      listProjects: async () => [],
      listServices: async () => [],
      findAllProjectDependencies: async () => [],
      getActionRunsByProject: async () => [],
      getActionRunsByApprovalStatus: async () => [],
      listActivityLogs: async () => [],
      listAllDeploymentPatterns: async () => [],
      findDeploymentPatternsByProject: async () => [],
      getDeployableForProject: async () => undefined,
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api/ops', createOpsRoutes(ctx));
  return app;
}

describe('ops AI automation routes in 0.1', () => {
  it.each([
    ['GET', '/api/ops/agent/active'],
    ['GET', '/api/ops/config'],
    ['PUT', '/api/ops/config'],
    ['GET', '/api/ops/digest/latest'],
    ['POST', '/api/ops/digest/trigger'],
    ['GET', '/api/ops/automation/defaults'],
    ['GET', '/api/ops/projects/proj-1/automation'],
    ['PUT', '/api/ops/projects/proj-1/automation'],
    ['DELETE', '/api/ops/projects/proj-1/automation'],
    ['GET', '/api/ops/postmortems'],
    ['GET', '/api/ops/postmortems/proj-1'],
  ] as const)('%s %s returns FEATURE_DISABLED', async (method, path) => {
    const app = createHarness();
    const res = await app.request(path, { method });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({
      error: 'FEATURE_DISABLED',
      code: 'FEATURE_DISABLED',
    });
  });

  it('keeps passive incident routes available', async () => {
    const app = createHarness();
    const res = await app.request('/api/ops/incidents');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ incidents: [] });
  });
});
