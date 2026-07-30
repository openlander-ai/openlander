import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import { createApprovalRoutes } from '../../../src/web/api/approval-routes.js';
import type { AppContext } from '../../../src/app.js';

function createTestApp(
  db: {
    getActionRunsByApprovalStatus?: ReturnType<typeof vi.fn>;
    getProject?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const ctx = {
    db: {
      getActionRunsByApprovalStatus: db.getActionRunsByApprovalStatus ?? vi.fn(async () => []),
      getProject: db.getProject ?? vi.fn(async () => undefined),
    },
  } as unknown as AppContext;
  const app = new Hono();
  app.route('/api', createApprovalRoutes(ctx));
  return app;
}

describe('Approval Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /api/approvals/pending', () => {
    it('returns empty array when no approvals exist', async () => {
      const res = await app.request('/api/approvals/pending');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ approvals: [] });
    });

    it('includes destructive MCP target keys in pending approval details', async () => {
      const appWithDestructive = createTestApp({
        getProject: vi.fn(async () => ({ id: 'proj-1', name: 'demo' })),
        getActionRunsByApprovalStatus: vi.fn(async () => [
          {
            id: 'run-mcp-1',
            project_id: 'proj-1',
            approval_tool: 'destructive_mcp',
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            created_at: '2026-05-05T00:00:00.000Z',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'bulk_delete_env_vars',
              args: { keys: ['DATABASE_URL', 'DEBUG'], confirm: true },
              identity: {
                source: 'mcp',
                initiatedBy: 'claude-code',
                mcpTokenId: 'test-pat-id',
                mcpTokenType: 'pat',
                mcpScopeKind: 'project',
                mcpScopeProjectId: 'proj-1',
              },
            }),
          },
        ]),
      });

      const res = await appWithDestructive.request('/api/approvals/pending');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.approvals[0]).toMatchObject({
        metadata: {
          actionRunId: 'run-mcp-1',
          projectName: 'demo',
          toolName: 'bulk_delete_env_vars',
          source: 'mcp',
          details: { keys: ['DATABASE_URL', 'DEBUG'] },
          actor: {
            source: 'mcp',
            initiatedBy: 'claude-code',
            tokenId: 'test-pat-id',
            tokenType: 'pat',
            scopeKind: 'project',
            scopeProjectId: 'proj-1',
          },
        },
      });
    });

    it('includes non-env destructive MCP target args in pending approval details', async () => {
      const appWithDestructive = createTestApp({
        getProject: vi.fn(async () => ({ id: 'proj-1', name: 'demo' })),
        getActionRunsByApprovalStatus: vi.fn(async () => [
          {
            id: 'run-mcp-2',
            project_id: 'proj-1',
            approval_tool: 'destructive_mcp',
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            created_at: '2026-05-05T00:00:00.000Z',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'remove_secret_file',
              args: { project_name: 'demo', filename: 'prod.env' },
            }),
          },
        ]),
      });

      const res = await appWithDestructive.request('/api/approvals/pending');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.approvals[0]).toMatchObject({
        metadata: {
          actionRunId: 'run-mcp-2',
          projectName: 'demo',
          toolName: 'remove_secret_file',
          source: 'mcp',
          details: { project_name: 'demo', filename: 'prod.env' },
        },
      });
    });

    it('shows secret-free Stateful Compose diff and backup effects', async () => {
      const appWithStateful = createTestApp({
        getProject: vi.fn(async () => ({ id: 'proj-1', name: 'demo' })),
        getActionRunsByApprovalStatus: vi.fn(async () => [
          {
            id: 'run-stateful-1',
            project_id: 'proj-1',
            approval_tool: 'destructive_mcp',
            approval_requested_at: '2026-07-30T00:00:00.000Z',
            created_at: '2026-07-30T00:00:00.000Z',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'update_app',
              args: { service_id: 'compose__svc', strategy: 'force' },
              statefulCompose: {
                changes: [
                  {
                    serviceName: 'db',
                    change: 'update',
                    changedFields: ['environment', 'healthcheck'],
                    backupVolumes: [{ name: 'demo-db', destination: '/var/lib/postgresql/data' }],
                  },
                ],
              },
            }),
          },
        ]),
      });

      const res = await appWithStateful.request('/api/approvals/pending');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.approvals[0]).toMatchObject({
        metadata: {
          toolName: 'update_app',
          details: {
            services: ['db'],
            changed_fields: ['environment', 'healthcheck'],
            backup: 'required before replacement',
            data_effect: 'previous containers and named volumes are retained for rollback',
          },
        },
      });
      expect(JSON.stringify(body)).not.toContain('demo-db');
      expect(JSON.stringify(body)).not.toContain('/var/lib/postgresql/data');
    });
  });
});
