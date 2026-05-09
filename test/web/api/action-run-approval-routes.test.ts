import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import { eventBus } from '../../../src/events/index.js';
import { createApiRoutes } from '../../../src/web/api/routes.js';

function createActionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-run-1',
    project_id: 'project-1',
    status: 'pending_approval',
    approval_status: 'pending',
    approval_tool: 'destructive_mcp',
    recovery_strategy: 'unknown',
    ...overrides,
  };
}

function createAppWithActionRun(actionRun = createActionRun()) {
  const db = {
    releaseDeployLock: vi.fn(async () => undefined),
    findActionRunPendingApproval: vi.fn(async () => actionRun),
    updateActionRunApproval: vi.fn(async () => undefined),
  };
  const app = new Hono();
  app.route('/api', createApiRoutes({ db } as unknown as AppContext));
  return { app, db };
}

describe('action run approval routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the shared approve route to emit destructive MCP execution events', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
    const { app, db } = createAppWithActionRun();

    const res = await app.request('/api/action-runs/action-run-1/approve', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(db.updateActionRunApproval).toHaveBeenCalledWith(
      'action-run-1',
      'approved',
      'destructive_mcp',
    );
    expect(emitSpy).toHaveBeenCalledWith('recovery:approval-resolved', {
      actionRunId: 'action-run-1',
      approved: true,
      projectId: 'project-1',
    });
  });

  it('uses the shared reject route for destructive MCP approvals too', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
    const { app, db } = createAppWithActionRun();

    const res = await app.request('/api/action-runs/action-run-1/reject', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(db.updateActionRunApproval).toHaveBeenCalledWith(
      'action-run-1',
      'rejected',
      'destructive_mcp',
    );
    expect(emitSpy).toHaveBeenCalledWith('recovery:approval-resolved', {
      actionRunId: 'action-run-1',
      approved: false,
      projectId: 'project-1',
    });
  });
});
