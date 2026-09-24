import { describe, expect, it, vi } from 'vitest';
import { createCompositeTools } from '../../src/mcp/composite-tools.js';
import { projectPermissionToolDefs } from '../../src/tools/defs/project-permissions.js';
import { appCleanupToolDefs } from '../../src/tools/defs/app-cleanup.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { handleDestructiveMcpApproval } from '../../src/mcp/destructive-executor.js';
import type { ToolContext } from '../../src/tools/defs/types.js';
import { OpenLanderError } from '../../src/errors.js';

function harness() {
  const services = new Map(
    Array.from({ length: 10 }, (_, i) => [
      `app-${i}`,
      {
        id: `app-${i}`,
        name: `app-${i}`,
        kind: 'git',
        project_id: 'a',
        archived_at: null,
        parent_service_id: null as string | null,
      },
    ]),
  );
  services.set('other', {
    id: 'other',
    name: 'other',
    kind: 'git',
    project_id: 'b',
    archived_at: null,
    parent_service_id: null,
  });
  const settings = new Map<string, string>();
  const runs = new Map<string, Record<string, any>>();
  const db = {
    getProject: vi.fn(async (id: string) => ({ id, name: id })),
    getProjectByName: vi.fn(async (name: string) => ({ id: name, name })),
    getService: vi.fn(async (id: string) => services.get(id) ?? null),
    listServices: vi.fn(async () => [...services.values()]),
    getActiveScopeProjectId: vi.fn(async () => null),
    getSetting: vi.fn(async (key: string) =>
      settings.has(key) ? { value: settings.get(key)! } : null,
    ),
    upsertSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    deleteSetting: vi.fn(async (key: string) => settings.delete(key)),
    insertActivityLog: vi.fn(async () => undefined),
    getActionRun: vi.fn(async (id: string) => runs.get(id) ?? null),
    createPendingMcpApproval: vi.fn(async (args: { projectId: string; plan: string }) => {
      const id = `run-${runs.size + 1}`;
      runs.set(id, {
        id,
        project_id: args.projectId,
        plan: args.plan,
        status: 'pending_approval',
        approval_status: 'pending',
        approval_tool: 'destructive_mcp',
      });
      return id;
    }),
    claimMcpActionExecution: vi.fn(async (id: string, permissionGranted = false) => {
      const run = runs.get(id)!;
      if (
        run.status !== 'pending_approval' ||
        run.approval_status === 'rejected' ||
        (!permissionGranted && run.approval_status !== 'approved')
      )
        return false;
      run.status = 'running';
      run.approval_status = 'approved';
      return true;
    }),
    updateActionRunPlan: vi.fn(async (id: string, plan: string) => {
      runs.get(id)!.plan = plan;
    }),
    updateActionRunStatus: vi.fn(async (id: string, status: string, error?: string) => {
      Object.assign(runs.get(id)!, { status, error_message: error });
    }),
  };
  const pipeline = {
    stopService: vi.fn(async (_id: string) => undefined),
    deleteService: vi.fn(async (id: string) => {
      services.delete(id);
      return {};
    }),
  };
  const context = {
    target: 'mcp',
    identity: {
      source: 'mcp',
      initiatedBy: 'owner',
      mcpScopeKind: 'project',
      mcpScopeProjectId: 'a',
    },
    appCtx: { db, pipeline, cloudflare: {} },
  } as unknown as ToolContext;
  const tools = createCompositeTools([
    ...projectPermissionToolDefs,
    ...appCleanupToolDefs,
    ...deployableServiceToolDefs,
    ...monitoringToolDefs,
  ]);
  const call = async (
    name: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<any> => tools.find((tool) => tool.name === name)!.execute({ action, params }, context);
  const grant = (ids?: string[]) =>
    call('openlander_project', 'set_project_permissions', {
      project_id: 'a',
      app_lifecycle: 'allow',
      ...(ids ? { action_run_ids: ids } : {}),
    });
  const cleanup = (ids: string[], operation = 'delete') =>
    call('openlander_service', 'cleanup_apps', { project_id: 'a', service_ids: ids, operation });
  return { services, settings, runs, db, pipeline, context, call, grant, cleanup };
}

describe('MCP permission continuation', () => {
  it('reports the actual default gate and grants app cleanup without granting data deletion', async () => {
    const h = harness();
    h.settings.set(
      'security.operation_permissions.global',
      JSON.stringify({ destructive_actions: 'block', database_access: 'block' }),
    );
    const before = await h.call('openlander_project', 'get_project_permissions', {
      project_id: 'a',
    });
    expect(before.permissions.effective.app_lifecycle).toBe('block');
    await h.grant();
    const after = await h.call('openlander_project', 'get_project_permissions', {
      project_id: 'a',
    });
    expect(after.permissions.effective).toMatchObject({
      app_lifecycle: 'allow',
      destructive_actions: 'block',
      database_access: 'block',
    });
    expect((await h.call('openlander_service', 'stop_app', { service_id: 'app-0' })).status).toBe(
      'stopped',
    );
    expect(h.db.createPendingMcpApproval).not.toHaveBeenCalled();
  });

  it('holds ten services once, then grants and resumes only that ID with per-service results', async () => {
    const h = harness();
    const permissions = await h.call('openlander_project', 'get_project_permissions', {
      project_id: 'a',
    });
    expect(permissions.permissions.effective.app_lifecycle).toBe('approval_required');
    const ids = Array.from({ length: 10 }, (_, i) => `app-${i}`);
    const pending = await h.cleanup(ids);
    expect(pending).toMatchObject({ status: 'pending_approval', total: 10 });
    const waiting = await h.call('openlander_monitor', 'mcp_action_status', {
      action_run_id: pending.action_run_id,
    });
    expect(waiting.requested_args_summary).toMatchObject({ operation: 'delete', service_ids: ids });
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
    const old = await h.call('openlander_service', 'stop_app', { service_id: 'app-0' });
    await h.grant([pending.action_run_id]);
    await vi.waitFor(() => expect(h.runs.get(pending.action_run_id)?.status).toBe('succeeded'));
    expect(h.runs.get(old.action_run_id)?.status).toBe('pending_approval');
    expect(h.pipeline.deleteService).toHaveBeenCalledTimes(10);
    const status = await h.call('openlander_monitor', 'mcp_action_status', {
      action_run_id: pending.action_run_id,
    });
    expect(status).toMatchObject({
      status: 'succeeded',
      result: { total: 10, succeeded: 10, failed: 0 },
    });
    expect(status.result.results).toHaveLength(10);
    await h.call('openlander_project', 'resume_mcp_actions', {
      project_id: 'a',
      action_run_ids: [pending.action_run_id],
    });
    expect(h.pipeline.deleteService).toHaveBeenCalledTimes(10);
  });

  it('never executes twice when web approval and repeated MCP continuation race', async () => {
    const h = harness();
    const pending = await h.cleanup(['app-0'], 'stop');
    await h.grant();
    h.runs.get(pending.action_run_id)!.approval_status = 'approved';
    await Promise.all([
      h.call('openlander_project', 'resume_mcp_actions', {
        project_id: 'a',
        action_run_ids: [pending.action_run_id],
      }),
      h.call('openlander_project', 'resume_mcp_actions', {
        project_id: 'a',
        action_run_ids: [pending.action_run_id],
      }),
      handleDestructiveMcpApproval(h.context.appCtx, {
        actionRunId: pending.action_run_id,
        approved: true,
        projectId: 'a',
      }),
    ]);
    await vi.waitFor(() => expect(h.runs.get(pending.action_run_id)?.status).toBe('succeeded'));
    expect(h.pipeline.stopService).toHaveBeenCalledTimes(1);
  });

  it('checks every service and action selector before granting or mutating', async () => {
    const h = harness();
    expect(await h.cleanup(['app-0', 'other'])).toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(await h.cleanup(['app-0', 'missing'])).toMatchObject({ code: 'SCOPE_VIOLATION' });
    const pending = await h.cleanup(['app-0']);
    h.runs.set('foreign', {
      id: 'foreign',
      project_id: 'b',
      plan: JSON.stringify({ targetProjectId: 'b' }),
    });
    expect(await h.grant([pending.action_run_id, 'foreign'])).toMatchObject({
      code: 'SCOPE_VIOLATION',
    });
    expect(await h.grant([pending.action_run_id, 'missing'])).toMatchObject({
      code: 'SCOPE_VIOLATION',
    });
    expect(h.settings.size).toBe(0);
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('preserves service-specific blocks and reports their source', async () => {
    const h = harness();
    const pending = await h.cleanup(['app-0']);
    h.settings.set(
      'security.operation_permissions.service.app-0',
      JSON.stringify({ destructive_actions: 'block' }),
    );
    const response = await h.grant([pending.action_run_id]);
    expect(response.continuation.actions[0]).toMatchObject({
      status: 'blocked',
      reason: { details: { permission: 'app_lifecycle', source: 'service' } },
    });
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('records partial failure and does not rerun failed or rejected work', async () => {
    const h = harness();
    await h.grant();
    h.pipeline.deleteService.mockRejectedValueOnce(
      new OpenLanderError('In use', 'SERVICE_HAS_CONSUMERS', 409),
    );
    const run = await h.cleanup(['app-0', 'app-1']);
    await vi.waitFor(() => expect(h.runs.get(run.action_run_id)?.status).toBe('failed'));
    const status = await h.call('openlander_monitor', 'mcp_action_status', {
      action_run_id: run.action_run_id,
    });
    expect(status.result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(status.result.results[0]).toMatchObject({
      service_id: 'app-0',
      error_code: 'SERVICE_HAS_CONSUMERS',
    });
    await h.call('openlander_project', 'resume_mcp_actions', {
      project_id: 'a',
      action_run_ids: [run.action_run_id],
    });
    expect(h.pipeline.deleteService).toHaveBeenCalledTimes(2);
  });

  it('stops remaining services if permission is revoked during a batch', async () => {
    const h = harness();
    await h.grant();
    h.pipeline.stopService.mockImplementationOnce(async () => {
      h.settings.set(
        'security.operation_permissions.project.a',
        JSON.stringify({ app_lifecycle: 'block' }),
      );
    });
    const run = await h.cleanup(['app-0', 'app-1'], 'stop');
    await vi.waitFor(() => expect(h.runs.get(run.action_run_id)?.status).toBe('failed'));
    expect(h.pipeline.stopService).toHaveBeenCalledTimes(1);
    const status = await h.call('openlander_monitor', 'mcp_action_status', {
      action_run_id: run.action_run_id,
    });
    expect(status.result).toMatchObject({ succeeded: 1, failed: 1 });
  });

  it('keeps single-service deletion status readable after the service is removed', async () => {
    const h = harness();
    const pending = await h.call('openlander_service', 'delete_app', { service_id: 'app-0' });
    await h.grant([pending.action_run_id]);
    await vi.waitFor(() => expect(h.runs.get(pending.action_run_id)?.status).toBe('succeeded'));
    expect(
      await h.call('openlander_monitor', 'mcp_action_status', {
        action_run_id: pending.action_run_id,
      }),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('checks Compose children and executes a selected parent/child only once', async () => {
    const h = harness();
    h.services.get('app-0')!.kind = 'compose';
    h.services.get('app-1')!.parent_service_id = 'app-0';
    await h.grant();
    h.settings.set(
      'security.operation_permissions.service.app-1',
      JSON.stringify({ app_lifecycle: 'block' }),
    );
    expect(await h.cleanup(['app-0', 'app-1'], 'stop')).toMatchObject({
      code: 'OPERATION_PERMISSION_DENIED',
    });
    expect(h.db.createPendingMcpApproval).not.toHaveBeenCalled();
    h.settings.delete('security.operation_permissions.service.app-1');
    const run = await h.cleanup(['app-0', 'app-1'], 'stop');
    expect(run.total).toBe(1);
    await vi.waitFor(() => expect(h.runs.get(run.action_run_id)?.status).toBe('succeeded'));
    expect(h.pipeline.stopService).toHaveBeenCalledExactlyOnceWith('app-0');
  });

  it('rejects out-of-scope descendants below a Compose child before creating a request', async () => {
    const h = harness();
    h.services.get('app-0')!.kind = 'compose';
    h.services.get('app-1')!.kind = 'compose-child';
    h.services.get('app-1')!.parent_service_id = 'app-0';
    h.services.get('other')!.parent_service_id = 'app-1';
    await expect(h.cleanup(['app-0'])).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(h.db.createPendingMcpApproval).not.toHaveBeenCalled();
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('never resumes a rejected request after a later Project grant', async () => {
    const h = harness();
    const pending = await h.cleanup(['app-0']);
    h.runs.get(pending.action_run_id)!.approval_status = 'rejected';
    await handleDestructiveMcpApproval(h.context.appCtx, {
      actionRunId: pending.action_run_id,
      approved: false,
      projectId: 'a',
    });
    await h.grant([pending.action_run_id]);
    expect(h.runs.get(pending.action_run_id)?.status).toBe('failed');
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });
});
