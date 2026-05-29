import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
import type { AppContext } from '../../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../../src/db/types.js';

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

describe('GET /api/ops/dependencies node status projection (S2.1)', () => {
  function createGraphHarness(opts: {
    projects: Array<Partial<ProjectRow> & { id: string; name: string }>;
    deployables: Record<string, Partial<ServiceRow> | undefined>;
    services?: Array<Partial<ServiceRow> & { id: string; name: string }>;
  }) {
    const ctx = {
      db: {
        listProjects: async () => opts.projects,
        listServices: async () => opts.services ?? [],
        findAllProjectDependencies: async () => [],
        getDeployableForProject: async (projectId: string) => opts.deployables[projectId],
      },
    } as unknown as AppContext;

    const app = new Hono();
    app.route('/api/ops', createOpsRoutes(ctx));
    return app;
  }

  it('pins project node status: passthrough + idle→"" bottom restoration', async () => {
    const app = createGraphHarness({
      projects: [
        { id: 'p-running', name: 'running-svc', status: null },
        { id: 'p-recovering', name: 'recovering-proj', status: 'recovering' },
        { id: 'p-empty', name: 'empty-proj', status: null },
      ],
      deployables: {
        // canonical services row wins → 'running' passes through
        'p-running': { id: 'p-running__svc', name: 'running-svc__svc', status: 'running' },
        // no services row → fall back to the deprecated project column
        'p-recovering': undefined,
        // no services row and project.status null → view normalizes to
        // 'idle', adapter must restore the historical '' bottom
        'p-empty': undefined,
      },
    });

    const res = await app.request('/api/ops/dependencies');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodes: Array<{ id: string; type: string; name: string; status: string }>;
    };

    expect(body.nodes).toEqual([
      { id: 'p-running', type: 'project', name: 'running-svc', status: 'running' },
      { id: 'p-recovering', type: 'project', name: 'recovering-proj', status: 'recovering' },
      { id: 'p-empty', type: 'project', name: 'empty-proj', status: '' },
    ]);
  });
});
