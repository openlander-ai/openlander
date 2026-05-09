import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

import { ApprovalGate } from '../../../src/pipeline/approval-gate.js';
import { createApprovalRoutes } from '../../../src/web/api/approval-routes.js';
import type { AppContext } from '../../../src/app.js';

function createTestApp(
  approvalGate: ApprovalGate,
  db: {
    getActionRunsByApprovalStatus?: ReturnType<typeof vi.fn>;
    getProject?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const ctx = {
    approvalGate,
    db: {
      getActionRunsByApprovalStatus: db.getActionRunsByApprovalStatus ?? vi.fn(async () => []),
      getProject: db.getProject ?? vi.fn(async () => undefined),
    },
  } as unknown as AppContext;
  const app = new Hono();
  app.route('/api', createApprovalRoutes(ctx));
  return app;
}

function addPendingApproval(gate: ApprovalGate, actionRunId: string, projectId = 'proj-1') {
  void gate.waitForApproval(actionRunId, {
    projectId,
    projectName: `project-${projectId}`,
    toolName: 'rollback_service',
    attempt: 1,
    actionRunId,
    createdAt: new Date(),
  });
}

describe('Approval Routes', () => {
  let gate: ApprovalGate;
  let app: Hono;

  beforeEach(() => {
    gate = new ApprovalGate();
    app = createTestApp(gate);
  });

  describe('GET /api/approvals/pending', () => {
    it('returns empty array when no approvals exist', async () => {
      const res = await app.request('/api/approvals/pending');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ approvals: [] });
    });

    it('returns pending approvals', async () => {
      addPendingApproval(gate, 'run-1', 'proj-1');
      addPendingApproval(gate, 'run-2', 'proj-2');

      const res = await app.request('/api/approvals/pending');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.approvals).toHaveLength(2);
      expect(body.approvals[0].metadata.actionRunId).toBe('run-1');
      expect(body.approvals[1].metadata.actionRunId).toBe('run-2');
    });

    it('includes destructive MCP target keys in pending approval details', async () => {
      const appWithDestructive = createTestApp(gate, {
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
                mcpTokenId: 'pat-1234567890',
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
            tokenId: 'pat-1234567890',
            tokenType: 'pat',
            scopeKind: 'project',
            scopeProjectId: 'proj-1',
          },
        },
      });
    });

    it('includes non-env destructive MCP target args in pending approval details', async () => {
      const appWithDestructive = createTestApp(gate, {
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
  });

  describe('POST /api/projects/:id/recovery/approve', () => {
    it('approves a pending recovery action', async () => {
      addPendingApproval(gate, 'run-1');

      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, message: 'Recovery approved' });

      expect(gate.getPendingApprovals()).toHaveLength(0);
    });

    it('returns 404 for non-existent actionRunId', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'does-not-exist' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Approval not found');
    });

    it('returns 409 for already-processed actionRunId', async () => {
      addPendingApproval(gate, 'run-processed');
      gate.approve('run-processed');

      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-processed' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Approval already processed');
    });

    it('returns 403 when actionRunId belongs to a different project', async () => {
      addPendingApproval(gate, 'run-1', 'proj-2');

      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-1' }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Approval does not belong to this project');
    });

    it('returns 400 when actionRunId is missing', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('actionRunId is required and must be a string');
    });

    it('returns 400 when actionRunId is not a string', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 123 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('actionRunId is required and must be a string');
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid JSON body');
    });
  });

  describe('POST /api/projects/:id/recovery/reject', () => {
    it('rejects a pending recovery action', async () => {
      addPendingApproval(gate, 'run-1');

      const res = await app.request('/api/projects/proj-1/recovery/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, message: 'Recovery rejected' });

      expect(gate.getPendingApprovals()).toHaveLength(0);
    });

    it('returns 404 for non-existent actionRunId', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'does-not-exist' }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Approval not found');
    });

    it('returns 409 for already-processed actionRunId', async () => {
      addPendingApproval(gate, 'run-processed');
      gate.reject('run-processed');

      const res = await app.request('/api/projects/proj-1/recovery/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-processed' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Approval already processed');
    });

    it('returns 403 when reject actionRunId belongs to a different project', async () => {
      addPendingApproval(gate, 'run-2', 'proj-2');

      const res = await app.request('/api/projects/proj-1/recovery/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionRunId: 'run-2' }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Approval does not belong to this project');
    });

    it('returns 400 when actionRunId is missing', async () => {
      const res = await app.request('/api/projects/proj-1/recovery/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('actionRunId is required and must be a string');
    });
  });
});
