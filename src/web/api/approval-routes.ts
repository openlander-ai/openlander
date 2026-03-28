import { Hono } from 'hono';

import type { AppContext } from '../../app.js';

export function createApprovalRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  function hasProjectMismatch(projectId: string, actionRunId: string): boolean {
    const pending = ctx.approvalGate.getPendingApprovals();
    const target = pending.find((entry) => entry.metadata.actionRunId === actionRunId);
    if (!target) {
      return false;
    }

    return target.metadata.projectId !== projectId;
  }

  // --- Pending Approvals ---

  api.get('/approvals/pending', (c) => {
    const approvals = ctx.approvalGate.getPendingApprovals();
    return c.json({ approvals });
  });

  // --- Approve Recovery Action ---

  api.post('/projects/:id/recovery/approve', async (c) => {
    let body: { actionRunId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { actionRunId } = body;
    if (!actionRunId || typeof actionRunId !== 'string') {
      return c.json({ error: 'actionRunId is required and must be a string' }, 400);
    }

    const projectId = c.req.param('id');
    if (hasProjectMismatch(projectId, actionRunId)) {
      return c.json({ error: 'Approval does not belong to this project' }, 403);
    }

    const found = ctx.approvalGate.approve(actionRunId);
    if (!found) {
      return c.json({ error: 'Approval not found or already processed' }, 404);
    }

    return c.json({ success: true, message: 'Recovery approved' });
  });

  // --- Reject Recovery Action ---

  api.post('/projects/:id/recovery/reject', async (c) => {
    let body: { actionRunId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { actionRunId } = body;
    if (!actionRunId || typeof actionRunId !== 'string') {
      return c.json({ error: 'actionRunId is required and must be a string' }, 400);
    }

    const projectId = c.req.param('id');
    if (hasProjectMismatch(projectId, actionRunId)) {
      return c.json({ error: 'Approval does not belong to this project' }, 403);
    }

    const found = ctx.approvalGate.reject(actionRunId);
    if (!found) {
      return c.json({ error: 'Approval not found or already processed' }, 404);
    }

    return c.json({ success: true, message: 'Recovery rejected' });
  });

  return api;
}
