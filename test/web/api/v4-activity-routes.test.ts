import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { createActivityRoutes } from '../../../src/web/api/activity-routes.js';

function createApp(db: Record<string, unknown>) {
  const app = new Hono();
  app.route('/api', createActivityRoutes({ db } as unknown as AppContext));
  return app;
}

function baseDb(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: async () => [{ id: 'group-1', name: 'workspace' }],
    getServices: async () => [{ id: 'svc-1', name: 'api', project_id: 'group-1' }],
    listRecentDeployLogsAcrossProjects: async () => [],
    findActivityLogRecent: async () => [],
    listUnresolvedRuntimeIncidents: async () => [],
    listRecentResolvedRuntimeIncidents: async () => [],
    listRecentClosedMcpSessions: async () => [],
    ...overrides,
  };
}

describe('GET /api/activity v4 feed', () => {
  it('maps service-scoped deploy logs back to their project group', async () => {
    const app = createApp(
      baseDb({
        listRecentDeployLogsAcrossProjects: async () => [
          {
            id: 'deploy-1',
            service_id: 'svc-1',
            status: 'success',
            trigger: 'api',
            trigger_detail: null,
            commit_sha: 'abcdef123456',
            commit_message: 'ship service model',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );

    const res = await app.request('/api/activity?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      id: 'deploy-deploy-1',
      kind: 'deploy_completed',
      project: 'group-1',
      service: 'svc-1',
      title: 'Deploy succeeded · abcdef1',
    });
  });

  it('maps chat deploy logs to the MCP actor', async () => {
    const app = createApp(
      baseDb({
        listRecentDeployLogsAcrossProjects: async () => [
          {
            id: 'deploy-1',
            service_id: 'svc-1',
            status: 'success',
            trigger: 'chat',
            trigger_detail: null,
            commit_sha: 'abcdef123456',
            commit_message: 'agent redeploy',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );

    const res = await app.request('/api/activity?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      id: 'deploy-deploy-1',
      actor: 'mcp',
      kind: 'deploy_completed',
    });
  });

  it('includes config activity_log rows in the dashboard feed', async () => {
    const app = createApp(
      baseDb({
        findActivityLogRecent: async () => [
          {
            id: 'activity-1',
            event_type: 'env:changed',
            activity_type: 'config',
            project_id: 'group-1',
            title: 'Environment variables set',
            description: 'set 2 environment variable(s)',
            metadata: JSON.stringify({ actor: 'mcp' }),
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );

    const res = await app.request('/api/activity?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      id: 'activity-activity-1',
      actor: 'mcp',
      kind: 'config_changed',
      project: 'group-1',
      service: null,
      title: 'Environment variables set',
      detail: 'set 2 environment variable(s)',
      detailCode: 'config_changed',
      detailParams: {},
    });
  });

  it('maps protected-share audit rows to the affected Application', async () => {
    const app = createApp(
      baseDb({
        findActivityLogRecent: async (_limit: number, filters: { activity_type?: string }) => {
          if (filters.activity_type !== 'config') return [];
          return [
            {
              id: 'share-1',
              event_type: 'public-access:verification-failed',
              activity_type: 'config',
              project_id: 'group-1',
              title: 'Protected share authentication failed',
              description: 'api · api.example.com · Invalid access code',
              metadata: JSON.stringify({ service_id: 'svc-1', reason: 'invalid_code' }),
              created_at: new Date().toISOString(),
            },
          ];
        },
      }),
    );

    const res = await app.request('/api/activity?limit=5&type=config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      id: 'activity-share-1',
      actor: 'system',
      kind: 'config_changed',
      project: 'group-1',
      service: 'svc-1',
      title: 'Protected share authentication failed',
      titleCode: 'public_access_verification_failed',
      detail: 'api · api.example.com · Invalid access code',
    });
    expect(body.activities[0]).not.toHaveProperty('detailCode');
  });

  it('includes data-access activity rows in the dashboard feed', async () => {
    const app = createApp(
      baseDb({
        findActivityLogRecent: async (_limit: number, filters: { activity_type?: string }) => {
          if (filters.activity_type !== 'data_access') return [];
          return [
            {
              id: 'data-1',
              event_type: 'data_access:read',
              activity_type: 'data_access',
              project_id: 'group-1',
              title: 'Agent data source read',
              description: 'sql.query on app-db',
              metadata: JSON.stringify({
                service_id: 'svc-1',
                kind: 'postgres',
                operation: 'sql.query',
                row_count: 2,
                duration_ms: 17,
                truncated: true,
                preview: "SELECT $$sk_live_secret$$ FROM users WHERE email='person@example.com'",
                query_hash: 'abcdef1234567890',
              }),
              created_at: new Date().toISOString(),
            },
          ];
        },
      }),
    );

    const res = await app.request('/api/activity?limit=5&type=data');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      id: 'activity-data-1',
      actor: 'mcp',
      kind: 'data_access_read',
      project: 'group-1',
      service: 'svc-1',
      title: 'Data source read · sql.query',
      detail: 'sql.query on app-db',
      detailCode: 'data_access_read',
      detailParams: {},
      dataAccess: {
        operation: 'sql.query',
        sourceKind: 'postgres',
        rowCount: 2,
        durationMs: 17,
        truncated: true,
        preview: "SELECT $[redacted]$ FROM users WHERE email='[redacted]'",
        queryHash: 'abcdef1234567890',
      },
    });
  });

  it('returns locale-neutral parameters for system-generated incident detail', async () => {
    const app = createApp(
      baseDb({
        listUnresolvedRuntimeIncidents: async () => [
          {
            id: 'incident-1',
            service_id: 'svc-1',
            exit_code: 137,
            category: 'restart_loop',
            restart_count: 4,
            created_at: new Date().toISOString(),
          },
        ],
      }),
    );

    const res = await app.request('/api/activity?limit=5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities[0]).toMatchObject({
      kind: 'service_crashed',
      detail: 'exit 137 · restart_loop · restart ×4',
      detailCode: 'service_crashed',
      detailParams: { exitCode: 137, restartCount: 4 },
    });
  });
});
