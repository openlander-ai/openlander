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
  settings?: Record<string, string>;
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
    getSetting: vi.fn(async (key: string) => {
      const value = overrides?.settings?.[key];
      return value === undefined ? null : { value };
    }),
  };
  return { target: 'mcp', appCtx: { db } as unknown as AppContext };
}

describe('MCP destructive safety', () => {
  it('allows Docker cleanup immediately under the default global permission', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('cleanup_docker'),
      { level: 'standard' },
      context,
    );

    expect(result).toBeUndefined();
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('holds Docker cleanup when the global destructive permission requires approval', async () => {
    const context = createContext({
      settings: {
        'security.operation_permissions.global': JSON.stringify({
          destructive_actions: 'approval_required',
          database_access: 'allow',
        }),
      },
    });
    const result = await maybeHandleMcpSafety(
      createTool('cleanup_docker'),
      { level: 'aggressive' },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      tool: 'cleanup_docker',
      action_run_id: 'action-run-1',
      effect_preview: {
        kind: 'cleanup_docker',
        runtime: 'preserve_running_containers_and_in_use_images',
      },
      after_approval: {
        succeeded: expect.stringContaining('get_disk_usage'),
      },
    });
    expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: '', toolName: 'cleanup_docker' }),
    );
    const pendingInput = vi.mocked(context.appCtx.db.createPendingMcpApproval).mock.calls[0]?.[0];
    expect(pendingInput?.plan).toContain('"level":"aggressive"');
  });

  it('blocks Docker cleanup when the global destructive permission is blocked', async () => {
    const context = createContext({
      settings: {
        'security.operation_permissions.global': JSON.stringify({
          destructive_actions: 'block',
          database_access: 'allow',
        }),
      },
    });
    const result = await maybeHandleMcpSafety(
      createTool('cleanup_docker'),
      { level: 'soft' },
      context,
    );

    expect(result).toMatchObject({
      status: 'blocked',
      error: 'OPERATION_PERMISSION_DENIED',
      tool: 'cleanup_docker',
      details: { permission: 'destructive_actions', project_id: null, service_id: null },
    });
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('executes policy-controlled resource deletion immediately when allowed by default', async () => {
    const context = createContext();
    const result = await maybeHandleMcpSafety(
      createTool('remove_service'),
      { service_name: 'db' },
      context,
    );

    expect(result).toBeUndefined();
    expect(context.appCtx.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('holds policy-controlled resource deletion when approval is required', async () => {
    const context = createContext({
      settings: {
        'security.operation_permissions.global': JSON.stringify({
          destructive_actions: 'approval_required',
          database_access: 'allow',
        }),
      },
    });
    const result = await maybeHandleMcpSafety(
      createTool('remove_service'),
      { service_name: 'db' },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      tool: 'remove_service',
      action_run_id: 'action-run-1',
    });
  });

  it('blocks database tools when database access is disabled', async () => {
    const context = createContext({
      settings: {
        'security.operation_permissions.global': JSON.stringify({
          destructive_actions: 'allow',
          database_access: 'block',
        }),
      },
    });
    const result = await maybeHandleMcpSafety(
      createTool('get_service_credentials'),
      { service_name: 'db' },
      context,
    );

    expect(result).toMatchObject({
      status: 'blocked',
      error: 'OPERATION_PERMISSION_DENIED',
      details: { permission: 'database_access' },
    });
  });

  it('applies the database-access permission to migration preflight', async () => {
    const context = createContext({
      settings: {
        'security.operation_permissions.global': JSON.stringify({
          destructive_actions: 'allow',
          database_access: 'block',
        }),
      },
    });
    const result = await maybeHandleMcpSafety(
      createTool('get_migration_preflight'),
      { project_id: 'project-1' },
      context,
    );

    expect(result).toMatchObject({
      status: 'blocked',
      error: 'OPERATION_PERMISSION_DENIED',
      tool: 'get_migration_preflight',
      details: { permission: 'database_access', project_id: 'project-1' },
    });
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

  it('holds repository credential deletion for human approval', async () => {
    const context = createContext({ projectId: null });
    const result = await maybeHandleMcpSafety(
      createTool('remove_git_credential'),
      { credential_id: 'gitcred_1' },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      tool: 'remove_git_credential',
    });
    expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'remove_git_credential' }),
    );
  });

  it('holds exact unused-network cleanup for human approval with a compact effect preview', async () => {
    const context = createContext({ projectId: null });
    const result = await maybeHandleMcpSafety(
      createTool('remove_unused_docker_network'),
      {
        network_name: 'ol-legacy',
        network_id: 'network-id',
        allow_legacy_unlabeled: true,
        idempotency_key: 'cleanup-network-1',
      },
      context,
    );

    expect(result).toMatchObject({
      status: 'pending_approval',
      action_run_id: 'action-run-1',
      tool: 'remove_unused_docker_network',
      effect_preview: {
        kind: 'remove_unused_docker_network',
        runtime: 'remove_zero_endpoint_network',
        data: 'preserve_containers_volumes',
        hard_delete: false,
      },
    });
    expect(context.appCtx.db.createPendingMcpApproval).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: '', toolName: 'remove_unused_docker_network' }),
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
        action_run_id: 'action-run-1',
        tool: toolName,
        projectId: 'project-1',
        project_id: 'project-1',
        poll_call: {
          tool: 'openlander_monitor',
          arguments: {
            action: 'mcp_action_status',
            params: { action_run_id: 'action-run-1' },
          },
        },
        effect_preview: {
          kind: toolName === 'archive_service' ? 'archive' : 'unarchive',
          hard_delete: false,
        },
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
        tokenScopeKind: 'project',
        tokenScopeProjectId: 'project-locked',
        tokenScopeServiceId: null,
        targetProjectId: 'project-1',
        reason: 'project_mismatch',
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
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'archive_service',
              args: { service_id: 'service-1', variables: { SECRET: 'not-returned' } },
              targetProjectId: 'project-1',
            }),
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
      requestedTool: 'archive_service',
      requested_tool: 'archive_service',
      requestedArgsSummary: { service_id: 'service-1' },
      requested_args_summary: { service_id: 'service-1' },
      lifecycle_effect: { kind: 'archive', hard_delete: false },
      poll_call: {
        tool: 'openlander_monitor',
        arguments: {
          action: 'mcp_action_status',
          params: { action_run_id: 'action-run-1' },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('not-returned');
  });

  it('routes succeeded archive status to archived-service inspection', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue({
            id: 'action-run-1',
            project_id: 'project-1',
            status: 'succeeded',
            approval_status: 'approved',
            approval_tool: 'destructive_mcp',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'archive_project',
              args: { project_id: 'project-1' },
              targetProjectId: 'project-1',
            }),
            error_message: null,
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            approval_resolved_at: '2026-05-05T00:01:00.000Z',
          }),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'action-run-1' }, context);

    expect(result).toMatchObject({
      status: 'succeeded',
      lifecycle_effect: { kind: 'archive', hard_delete: false },
      suggested_call: {
        tool: 'openlander_service',
        arguments: {
          action: 'list_archived_services',
          params: { project_id: 'project-1' },
        },
      },
      _agent_guidance: {
        message: expect.stringContaining('not permanent deletion'),
      },
    });
  });

  it('returns structured archive lock evidence without exposing arbitrary error details', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue({
            id: 'action-run-locked',
            project_id: 'project-1',
            status: 'failed',
            approval_status: 'approved',
            approval_tool: 'destructive_mcp',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'archive_service',
              args: { service_id: 'service-1' },
              targetProjectId: 'project-1',
              failure: {
                code: 'DEPLOY_LOCKED',
                message: 'A deployment is active.',
                details: {
                  projectId: 'runtime-1',
                  lockedBySession: 'deploy-live-session',
                  blockedServiceId: 'runtime-1__svc',
                  statusSource: 'deploy_lock',
                  secret: 'must-not-return',
                },
              },
            }),
            error_message: 'DEPLOY_LOCKED: A deployment is active.',
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            approval_resolved_at: '2026-05-05T00:01:00.000Z',
          }),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'action-run-locked' }, context);

    expect(result).toMatchObject({
      status: 'failed',
      error_code: 'DEPLOY_LOCKED',
      error_details: {
        project_id: 'runtime-1',
        lock_session: 'deploy-live-session',
        blocked_service_id: 'runtime-1__svc',
        status_source: 'deploy_lock',
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-return');
  });

  it('keeps succeeded restore status explicit that redeploy is separate', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue({
            id: 'action-run-restore',
            project_id: 'project-1',
            status: 'succeeded',
            approval_status: 'approved',
            approval_tool: 'destructive_mcp',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'unarchive_service',
              args: { service_id: 'service-1' },
              targetProjectId: 'project-1',
            }),
            error_message: null,
            approval_requested_at: '2026-05-05T00:00:00.000Z',
            approval_resolved_at: '2026-05-05T00:01:00.000Z',
          }),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'action-run-restore' }, context);

    expect(result).toMatchObject({
      status: 'succeeded',
      lifecycle_effect: {
        kind: 'unarchive',
        runtime: 'resume_preserved_stateful_or_no_auto_start',
      },
      _agent_guidance: {
        message: expect.stringContaining('Preserved Stateful Compose resources resumed in place'),
        next_steps: expect.arrayContaining([
          expect.stringContaining('Call update_app only when no container was restored'),
        ]),
      },
    });
  });

  it('returns a compact Docker cleanup result and disk-usage follow-up after approval', async () => {
    const statusTool = monitoringToolDefs.find((tool) => tool.name === 'mcp_action_status');
    expect(statusTool).toBeDefined();
    const context = {
      target: 'mcp',
      appCtx: {
        db: {
          getActionRun: vi.fn().mockResolvedValue({
            id: 'action-run-cleanup',
            project_id: '',
            status: 'succeeded',
            approval_status: 'approved',
            approval_tool: 'destructive_mcp',
            plan: JSON.stringify({
              type: 'destructive_mcp',
              tool: 'cleanup_docker',
              args: { level: 'standard' },
              targetProjectId: null,
              result: {
                level: 'standard',
                totalReclaimedMB: 128.5,
                dockerUsage: {
                  before: { available: true, reportedTotalSizeBytes: 2_000 },
                  after: { available: true, reportedTotalSizeBytes: 1_000 },
                },
                secret: 'must-not-return',
              },
            }),
            error_message: null,
            approval_requested_at: '2026-08-06T00:00:00.000Z',
            approval_resolved_at: '2026-08-06T00:01:00.000Z',
          }),
        },
      } as unknown as AppContext,
    } as ToolContext;

    const result = await statusTool!.execute({ action_run_id: 'action-run-cleanup' }, context);

    expect(result).toMatchObject({
      status: 'succeeded',
      requested_args_summary: { level: 'standard' },
      lifecycle_effect: { kind: 'cleanup_docker', hard_delete: false },
      result: {
        level: 'standard',
        total_reclaimed_mb: 128.5,
        docker_usage_before_bytes: 2_000,
        docker_usage_after_bytes: 1_000,
      },
      suggested_call: {
        tool: 'openlander_managed_service',
        arguments: { action: 'get_disk_usage', params: {} },
      },
      _agent_guidance: {
        message: expect.stringContaining('before/after'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-return');
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
