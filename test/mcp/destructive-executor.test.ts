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
          source: 'mcp',
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

  it('executes approved deployable archive_service approvals', async () => {
    const service = {
      id: 'project-1__svc',
      name: 'web',
      project_id: 'project-1',
      kind: 'git',
      source: 'git',
    };
    const project = { id: 'project-1', name: 'demo' };
    const db = {
      getActionRun: vi.fn().mockResolvedValue({
        id: 'action-run-archive',
        approval_tool: 'destructive_mcp',
        plan: JSON.stringify({
          type: 'destructive_mcp',
          tool: 'archive_service',
          args: { service_id: service.id },
          targetProjectId: project.id,
          requestedAt: '2026-05-05T00:00:00.000Z',
        }),
      }),
      getService: vi.fn().mockResolvedValue(service),
      getProject: vi.fn().mockResolvedValue(project),
      updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
      updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = { archive: vi.fn().mockResolvedValue(undefined) };
    const ctx = { db, pipeline } as unknown as AppContext;

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-archive',
      approved: true,
      projectId: project.id,
    });

    expect(pipeline.archive).toHaveBeenCalledWith(project.id);
    expect(db.updateActionRunStatus).toHaveBeenNthCalledWith(1, 'action-run-archive', 'running');
    expect(db.updateActionRunPlan).toHaveBeenCalledWith(
      'action-run-archive',
      expect.stringContaining('"status":"archived"'),
    );
    expect(db.updateActionRunStatus).toHaveBeenLastCalledWith('action-run-archive', 'succeeded');
  });

  it('executes approved deployable unarchive_service approvals without redeploying', async () => {
    const service = {
      id: 'project-1__svc',
      name: 'web',
      project_id: 'project-1',
      kind: 'git',
      source: 'git',
    };
    const project = { id: 'project-1', name: 'demo' };
    const db = {
      getActionRun: vi.fn().mockResolvedValue({
        id: 'action-run-unarchive',
        approval_tool: 'destructive_mcp',
        plan: JSON.stringify({
          type: 'destructive_mcp',
          tool: 'unarchive_service',
          args: { service_id: service.id },
          targetProjectId: project.id,
          requestedAt: '2026-05-05T00:00:00.000Z',
        }),
      }),
      getService: vi.fn().mockResolvedValue(service),
      getProject: vi.fn().mockResolvedValue(project),
      updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
      updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = {
      unarchive: vi.fn().mockResolvedValue(undefined),
      redeploy: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = { db, pipeline } as unknown as AppContext;

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-unarchive',
      approved: true,
      projectId: project.id,
    });

    expect(pipeline.unarchive).toHaveBeenCalledWith(project.id);
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(db.updateActionRunStatus).toHaveBeenNthCalledWith(1, 'action-run-unarchive', 'running');
    expect(db.updateActionRunPlan).toHaveBeenCalledWith(
      'action-run-unarchive',
      expect.stringContaining('"status":"unarchived"'),
    );
    expect(db.updateActionRunStatus).toHaveBeenLastCalledWith('action-run-unarchive', 'succeeded');
  });

  it('executes approved project archive_project approvals', async () => {
    const project = { id: 'project-1', name: 'demo' };
    const db = {
      getActionRun: vi.fn().mockResolvedValue({
        id: 'action-run-project-archive',
        approval_tool: 'destructive_mcp',
        plan: JSON.stringify({
          type: 'destructive_mcp',
          tool: 'archive_project',
          args: { project_name: project.name },
          targetProjectId: project.id,
          requestedAt: '2026-05-05T00:00:00.000Z',
        }),
      }),
      getProject: vi.fn().mockResolvedValue(project),
      getProjectByName: vi.fn().mockResolvedValue(project),
      updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
      updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = { archiveGroup: vi.fn().mockResolvedValue(undefined) };
    const ctx = { db, pipeline } as unknown as AppContext;

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-project-archive',
      approved: true,
      projectId: project.id,
    });

    expect(pipeline.archiveGroup).toHaveBeenCalledWith(project.id);
    expect(db.updateActionRunStatus).toHaveBeenNthCalledWith(
      1,
      'action-run-project-archive',
      'running',
    );
    expect(db.updateActionRunPlan).toHaveBeenCalledWith(
      'action-run-project-archive',
      expect.stringContaining('"status":"archived"'),
    );
    expect(db.updateActionRunStatus).toHaveBeenLastCalledWith(
      'action-run-project-archive',
      'succeeded',
    );
  });

  it('executes approved project unarchive_project approvals without redeploying', async () => {
    const project = { id: 'project-1', name: 'demo' };
    const db = {
      getActionRun: vi.fn().mockResolvedValue({
        id: 'action-run-project-unarchive',
        approval_tool: 'destructive_mcp',
        plan: JSON.stringify({
          type: 'destructive_mcp',
          tool: 'unarchive_project',
          args: { project_id: project.id },
          targetProjectId: project.id,
          requestedAt: '2026-05-05T00:00:00.000Z',
        }),
      }),
      getProject: vi.fn().mockResolvedValue(project),
      getProjectByName: vi.fn().mockResolvedValue(project),
      updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
      updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
    };
    const pipeline = {
      unarchiveGroup: vi.fn().mockResolvedValue(undefined),
      redeploy: vi.fn().mockResolvedValue(undefined),
    };
    const ctx = { db, pipeline } as unknown as AppContext;

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-project-unarchive',
      approved: true,
      projectId: project.id,
    });

    expect(pipeline.unarchiveGroup).toHaveBeenCalledWith(project.id);
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(db.updateActionRunStatus).toHaveBeenNthCalledWith(
      1,
      'action-run-project-unarchive',
      'running',
    );
    expect(db.updateActionRunPlan).toHaveBeenCalledWith(
      'action-run-project-unarchive',
      expect.stringContaining('"status":"unarchived"'),
    );
    expect(db.updateActionRunStatus).toHaveBeenLastCalledWith(
      'action-run-project-unarchive',
      'succeeded',
    );
  });

  it('executes approved exact unused-network cleanup through the operation registry', async () => {
    const db = {
      getActionRun: vi.fn().mockResolvedValue({
        id: 'action-run-network-cleanup',
        approval_tool: 'destructive_mcp',
        plan: JSON.stringify({
          type: 'destructive_mcp',
          tool: 'remove_unused_docker_network',
          args: {
            network_name: 'ol-legacy',
            network_id: 'network-id',
            allow_legacy_unlabeled: true,
            idempotency_key: 'cleanup-network-1',
          },
          targetProjectId: null,
          requestedAt: '2026-07-27T00:00:00.000Z',
        }),
      }),
      updateActionRunPlan: vi.fn().mockResolvedValue(undefined),
      updateActionRunStatus: vi.fn().mockResolvedValue(undefined),
    };
    const operations = {
      execute: vi.fn().mockResolvedValue({
        operation_id: 'operation-1',
        version: 1,
        replayed: false,
        result: {
          status: 'removed',
          network_name: 'ol-legacy',
          network_id: 'network-id',
        },
      }),
    };
    const ctx = {
      db,
      operations,
      config: { mcp: { instanceId: 'olinst_a' } },
    } as unknown as AppContext;

    await handleDestructiveMcpApproval(ctx, {
      actionRunId: 'action-run-network-cleanup',
      approved: true,
      projectId: '',
    });

    expect(operations.execute).toHaveBeenCalledWith(
      ctx,
      'remove_unused_docker_network',
      {
        network_name: 'ol-legacy',
        network_id: 'network-id',
        allow_legacy_unlabeled: true,
      },
      expect.objectContaining({ idempotencyKey: 'cleanup-network-1' }),
    );
    expect(db.updateActionRunStatus).toHaveBeenNthCalledWith(
      1,
      'action-run-network-cleanup',
      'running',
    );
    expect(db.updateActionRunStatus).toHaveBeenLastCalledWith(
      'action-run-network-cleanup',
      'succeeded',
    );
  });
});
