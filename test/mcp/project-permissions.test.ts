import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/tools/defs/types.js';
import { createCompositeTools } from '../../src/mcp/composite-tools.js';
import { projectPermissionToolDefs } from '../../src/tools/defs/project-permissions.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { maybeHandleMcpSafety } from '../../src/mcp/destructive-safety.js';
import { createApplicationOperationRegistry } from '../../src/operations/registry.js';

function harness() {
  const projects = [
    { id: 'a', name: 'alpha' },
    { id: 'b', name: 'beta' },
  ];
  const services = Array.from({ length: 10 }, (_, i) => ({
    id: `a${i}__svc`,
    name: `app${i}`,
    project_id: 'a',
    kind: 'git',
    archived_at: null,
  }));
  services.push({ id: 'b__svc', name: 'beta', project_id: 'b', kind: 'git', archived_at: null });
  const settings = new Map<string, string>();
  const db = {
    getProject: vi.fn(async (id: string) => projects.find((p) => p.id === id)),
    getProjectByName: vi.fn(async (name: string) => projects.find((p) => p.name === name)),
    getService: vi.fn(async (id: string) => services.find((s) => s.id === id)),
    getDeployablesByGroup: vi.fn(async (id: string) => services.filter((s) => s.project_id === id)),
    listServices: vi.fn(async () => services),
    getActiveScopeProjectId: vi.fn(async () => null),
    getSetting: vi.fn(async (key: string) =>
      settings.has(key) ? { value: settings.get(key)! } : null,
    ),
    upsertSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    deleteSetting: vi.fn(async (key: string) => settings.delete(key)),
    insertActivityLog: vi.fn(async () => ({})),
    createPendingMcpApproval: vi.fn(async () => 'pending-1'),
  };
  const pipeline = {
    stopService: vi.fn(async () => {}),
    deleteService: vi.fn(async () => ({})),
    archive: vi.fn(async () => {}),
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
  const tools = createCompositeTools([...projectPermissionToolDefs, ...deployableServiceToolDefs]);
  const call = (composite: string, action: string, params: Record<string, unknown>) =>
    tools.find((t) => t.name === composite)!.execute({ action, params }, context);
  return { context, db, pipeline, settings, call };
}

describe('Project permission through MCP', () => {
  it('persists one Project grant and executes ten service deletions without approval prompts', async () => {
    const h = harness();
    await expect(
      h.call('openlander_project', 'set_project_permissions', {
        project_id: 'a',
        destructive_actions: 'allow',
      }),
    ).resolves.toMatchObject({ status: 'updated', project_id: 'a' });
    for (let i = 0; i < 10; i++) {
      await expect(
        h.call('openlander_service', 'delete_app', { service_id: `a${i}__svc` }),
      ).resolves.toMatchObject({ status: 'deleted', service_id: `a${i}__svc` });
    }
    expect(h.pipeline.deleteService).toHaveBeenCalledTimes(10);
    expect(h.db.createPendingMcpApproval).not.toHaveBeenCalled();
    expect([...h.settings.keys()]).toEqual(['security.operation_permissions.project.a']);
    expect(h.db.insertActivityLog).toHaveBeenCalledOnce();
  });

  it('holds lifecycle actions before a grant and honors block after permission is revoked', async () => {
    const h = harness();
    await expect(
      h.call('openlander_service', 'stop_app', { service_id: 'a0__svc' }),
    ).resolves.toMatchObject({ status: 'pending_approval' });
    expect(h.pipeline.stopService).not.toHaveBeenCalled();
    await h.call('openlander_project', 'set_project_permissions', {
      project_name: 'alpha',
      destructive_actions: 'allow',
    });
    await expect(
      h.call('openlander_service', 'stop_app', { service_id: 'a0__svc' }),
    ).resolves.toMatchObject({ status: 'stopped' });
    await h.call('openlander_project', 'set_project_permissions', {
      project_id: 'a',
      destructive_actions: 'block',
    });
    await expect(
      h.call('openlander_service', 'delete_app', { service_id: 'a0__svc' }),
    ).resolves.toMatchObject({ code: 'OPERATION_PERMISSION_DENIED' });
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('does not grant another Project or bypass a service override', async () => {
    const h = harness();
    await h.call('openlander_project', 'set_project_permissions', {
      project_id: 'a',
      destructive_actions: 'allow',
    });
    h.context.identity = { source: 'mcp', mcpScopeKind: 'org' };
    await expect(
      h.call('openlander_service', 'delete_app', { service_id: 'b__svc' }),
    ).resolves.toMatchObject({ status: 'pending_approval' });
    h.settings.set(
      'security.operation_permissions.service.a0__svc',
      JSON.stringify({ destructive_actions: 'block' }),
    );
    await expect(
      h.call('openlander_service', 'delete_app', { service_id: 'a0__svc' }),
    ).resolves.toMatchObject({ code: 'OPERATION_PERMISSION_DENIED' });
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('checks every supplied Project selector before changing permissions', async () => {
    const h = harness();
    await expect(
      h.call('openlander_project', 'set_project_permissions', {
        project_id: 'a',
        project_name: 'beta',
        destructive_actions: 'allow',
      }),
    ).resolves.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(h.db.upsertSetting).not.toHaveBeenCalled();
    await expect(
      h.call('openlander_service', 'delete_app', { service_id: 'b__svc', project_name: 'alpha' }),
    ).resolves.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(h.pipeline.deleteService).not.toHaveBeenCalled();
  });

  it('does not let a service token grant Project-wide permissions', async () => {
    const h = harness();
    h.context.identity = {
      source: 'mcp',
      mcpScopeKind: 'service',
      mcpScopeProjectId: 'a',
      mcpScopeServiceId: 'a0__svc',
    };
    const result = await h.call('openlander_project', 'set_project_permissions', {
      project_id: 'a',
      destructive_actions: 'allow',
    });
    expect(result).toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(h.db.upsertSetting).not.toHaveBeenCalled();
  });

  it.each(['archive_service', 'unarchive_service', 'stop_service', 'remove_service'])(
    'uses the Project grant for %s',
    async (name) => {
      const h = harness();
      h.settings.set(
        'security.operation_permissions.project.a',
        JSON.stringify({ destructive_actions: 'allow' }),
      );
      const def = { name } as Parameters<typeof maybeHandleMcpSafety>[0];
      await expect(
        maybeHandleMcpSafety(def, { service_id: 'a0__svc' }, h.context),
      ).resolves.toBeUndefined();
    },
  );

  it('removes FDE commands from the executable operation registry', () => {
    const names = createApplicationOperationRegistry()
      .list()
      .map((d) => d.name);
    expect(names).toEqual(['list_docker_networks', 'remove_unused_docker_network']);
  });
});
