import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { assertMcpActiveScope, maybeHandleMcpSafety } from '../../src/mcp/destructive-safety.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import type { ToolContext, ToolDef } from '../../src/tools/defs/types.js';
import type { RequestIdentity } from '../../src/types/identity.js';

function createTool(name: string): ToolDef {
  return {
    name,
    description: name,
    inputSchema: {
      safeParse: (value: unknown) => ({ success: true, data: value }),
    } as ToolDef['inputSchema'],
    execute: vi.fn(),
  };
}

function createContext(overrides?: {
  activeScopeProjectId?: string | null;
  projectId?: string | null;
}): ToolContext {
  const db = {
    getActiveScopeProjectId: vi.fn().mockResolvedValue(overrides?.activeScopeProjectId ?? null),
    createPendingMcpApproval: vi.fn().mockResolvedValue('action-run-1'),
    getProject: vi
      .fn()
      .mockResolvedValue(
        overrides?.projectId === null
          ? undefined
          : { id: overrides?.projectId ?? 'project-1', name: 'demo' },
      ),
    getProjectByName: vi
      .fn()
      .mockResolvedValue(
        overrides?.projectId === null
          ? undefined
          : { id: overrides?.projectId ?? 'project-1', name: 'demo' },
      ),
    getService: vi.fn(),
    listServices: vi.fn().mockResolvedValue([]),
  };
  return { target: 'mcp', appCtx: { db } as unknown as AppContext };
}

describe('MCP destructive safety', () => {
  it('blocks Group A destructive tools at the MCP boundary', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('remove_service'),
      { service_name: 'db' },
      context,
    );

    expect(result).toMatchObject({
      error: 'OPERATION_REQUIRES_HUMAN_UI',
      code: 'OPERATION_REQUIRES_HUMAN_UI',
    });
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('lets platform_cleanup_orphans dry-run preview execute through MCP', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('platform_cleanup_orphans'),
      { dry_run: true },
      context,
    );

    expect(result).toBeUndefined();
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('still blocks platform_cleanup_orphans execution over MCP', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('platform_cleanup_orphans'),
      { confirm: true, dry_run: false },
      context,
    );

    expect(result).toMatchObject({
      error: 'OPERATION_REQUIRES_HUMAN_UI',
      code: 'OPERATION_REQUIRES_HUMAN_UI',
    });
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('lets bulk_delete_env_vars dry-run execute immediately', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('bulk_delete_env_vars'),
      { project_name: 'demo', keys: ['A'] },
      context,
    );

    expect(result).toBeUndefined();
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('routes confirmed Group B deletes to a pending approval row', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('bulk_delete_env_vars'),
      { project_name: 'demo', keys: ['A'], confirm: true },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      actionRunId: 'action-run-1',
      tool: 'bulk_delete_env_vars',
      projectId: 'project-1',
    });
    expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        toolName: 'bulk_delete_env_vars',
      }),
    );
  });

  it('routes deployable service archive/restore to pending approval rows', async () => {
    for (const toolName of ['archive_service', 'unarchive_service'] as const) {
      const context = createContext();
      const result = await maybeHandleMcpSafety(
        createTool(toolName),
        { project_name: 'demo', service_name: 'web' },
        context,
      );

      expect(result).toMatchObject({
        status: 'pending_approval',
        actionRunId: 'action-run-1',
        tool: toolName,
        projectId: 'project-1',
      });
      expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          toolName,
        }),
      );
    }
  });

  it('routes project group archive/restore to pending approval rows', async () => {
    for (const toolName of ['archive_project', 'unarchive_project'] as const) {
      const context = createContext();
      const result = await maybeHandleMcpSafety(
        createTool(toolName),
        { project_name: 'demo' },
        context,
      );

      expect(result).toMatchObject({
        status: 'pending_approval',
        actionRunId: 'action-run-1',
        tool: toolName,
        projectId: 'project-1',
      });
      expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          toolName,
        }),
      );
    }
  });

  it('ignores stale global active scope rows for org-scoped v0.1 MCP calls', async () => {
    const context = createContext({ activeScopeProjectId: 'project-locked' });

    const result = await maybeHandleMcpSafety(
      createTool('bulk_delete_env_vars'),
      { project_name: 'demo', keys: ['A'], confirm: true },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      projectId: 'project-1',
    });
  });

  it('uses a distinct code when approved destructive execution drifts out of scope', async () => {
    const context = createContext({ activeScopeProjectId: 'project-locked' });
    const identity: RequestIdentity = {
      source: 'mcp',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'project-locked',
    };

    await expect(
      assertMcpActiveScope(context.appCtx, 'project-1', true, identity),
    ).rejects.toMatchObject({
      code: 'SCOPE_MISMATCH_AT_EXECUTE',
      details: {
        activeScopeProjectId: 'project-locked',
        targetProjectId: 'project-1',
      },
    });
  });

  it('maps held MCP action run status for agents polling the approval result', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue({
            id: 'action-run-1',
            project_id: 'project-1',
            status: 'pending_approval',
            approval_status: 'approved',
            approval_tool: 'destructive_mcp',
            error_message: null,
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            approval_resolved_at: '2026-05-05T00:01:00.000Z',
          }),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'action-run-1' }, context);

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'approved_executing',
      projectId: 'project-1',
      approvalStatus: 'approved',
      approvalTool: 'destructive_mcp',
    });
  });

  it('returns not_found from mcp_action_status for unknown action runs', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'missing' }, context);

    expect(result).toMatchObject({
      status: 'not_found',
      code: 'NOT_FOUND',
    });
  });
});
