import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { handleDestructiveMcpApproval } from '../../src/mcp/destructive-executor.js';

function createApprovalContext() {
  const db = {
    getActionRun: vi.fn().mockResolvedValue({
      id: 'action-run-1',
      approval_tool: 'destructive_mcp',
      plan: JSON.stringify({
        type: 'destructive_mcp',
        tool: 'bulk_delete_env_vars',
        args: { project_name: 'demo', keys: ['DATABASE_URL'], confirm: true },
        targetProjectId: 'project-1',
        identity: {
          mcpScopeKind: 'project',
          mcpScopeProjectId: 'project-2',
        },
        requestedAt: '2026-05-05T00:00:00.000Z',
      }),
    }),
    updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
    updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
  };

  return {
    ctx: { db } as unknown as AppContext,
    db,
  };
}

describe('destructive MCP approval executor', () => {
  it('fails before execution when the project-scoped MCP token does not match the target', async () => {
    const { ctx, db } = createApprovalContext();

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-1',
      approved: true,
      projectId: 'project-1',
    });

    expect(db.updateActionRunStatus).toHaveBeenCalledWith(
      'action-run-1',
      'failed',
      expect.stringContaining('SCOPE_MISMATCH_AT_EXECUTE'),
    );
    expect(db.updateActionRunStatus).not.toHaveBeenCalledWith('action-run-1', 'running');
    expect(db.updateActionRunPlan).not.toHaveBeenCalled();
  });
});
