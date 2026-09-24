import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { Database } from '../../src/db/index.js';
import { createOpenLanderManagedServiceCompositeTool } from '../../src/mcp/composite-tools.js';
import { deserializeConfig } from '../../src/pipeline/config-snapshot.js';
import {
  getManagedServiceResources,
  updateManagedServiceResources,
} from '../../src/pipeline/managed-service-resources.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import type { RequestIdentity } from '../../src/types/identity.js';

const MB = 1024 * 1024;
const actions = ['get_service_resources', 'update_service_resources'] as const;

function harness(identity?: RequestIdentity) {
  const service = {
    id: 'db-1',
    name: 'pg',
    project_id: 'p-1',
    kind: 'postgres',
    container_id: 'container-1',
    status: 'running',
    archived_at: null,
  };
  const services = [
    service,
    { ...service, id: 'db-2', name: 'other-pg', project_id: 'p-2' },
    { ...service, id: 'sibling', name: 'sibling-pg' },
  ];
  const info = {
    HostConfig: {
      Memory: 512 * MB,
      MemorySwap: 512 * MB,
      MemoryReservation: 256 * MB,
      CpuShares: 512,
    },
    State: { Running: true },
  };
  let config: string | undefined;
  const db = {
    getService: vi.fn(async (id: string) => services.find((s) => s.id === id) ?? null),
    listServices: vi.fn(async () => services),
    getProject: vi.fn(async () => ({ id: 'p-1', name: 'project', archived_at: null })),
    acquireDeployLock: vi.fn(async () => true),
    releaseDeployLock: vi.fn(async () => true),
    getDeployLockInfo: vi.fn(async () => ({ session: 'deployment' })),
    isCircuitBreakerOpen: vi.fn(async () => false),
    loadDeployConfigForService: vi.fn(async () => (config ? { config_json: config } : null)),
    saveDeployConfigForService: vi.fn(async (_id: string, value: string) => {
      config = value;
    }),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const runtime = {
    inspectContainer: vi.fn(async () => structuredClone(info)),
    updateContainerMemory: vi.fn(async (_id: string, memory: number) => {
      Object.assign(info.HostConfig, {
        Memory: memory,
        MemorySwap: memory,
        MemoryReservation: Math.floor(memory / 2),
      });
    }),
  };
  const manager = {
    list: vi.fn(async () => services),
    getResourceLimits: vi.fn((id: string) =>
      getManagedServiceResources(
        db as unknown as Database,
        runtime as unknown as RuntimeBackend,
        id,
      ),
    ),
    updateResourceLimits: vi.fn(
      (id: string, input: Parameters<typeof updateManagedServiceResources>[3]) =>
        updateManagedServiceResources(
          db as unknown as Database,
          runtime as unknown as RuntimeBackend,
          id,
          input,
        ),
    ),
  };
  const context = {
    target: 'mcp' as const,
    identity,
    appCtx: { db, serviceManager: manager } as unknown as AppContext,
  };
  const tool = createOpenLanderManagedServiceCompositeTool(serviceToolDefs);
  return {
    db,
    runtime,
    manager,
    service,
    info,
    tool,
    context,
    call: (action: string, params: Record<string, unknown>) =>
      tool.execute({ action, params }, context),
  };
}

function paramsFor(action: string) {
  return {
    service_id: 'db-1',
    ...(action === 'update_service_resources'
      ? { resource_profile: 'custom', memory_mb: 768 }
      : {}),
  };
}

describe('managed-service memory MCP', () => {
  it('publishes both actions and their input contracts through help', async () => {
    const h = harness();
    const help = (await h.call('help', {})) as { actions: Array<{ name: string }> };
    expect(help.actions.map((a) => a.name)).toEqual(expect.arrayContaining(actions));
    const detail = (await h.call('help', { action_name: 'update_service_resources' })) as {
      action: Record<string, unknown>;
    };
    expect(detail.action).toMatchObject({
      name: 'update_service_resources',
      required_params: ['resource_profile'],
      optional_params: expect.arrayContaining(['service_id', 'service_name', 'memory_mb']),
    });
    expect(detail.action.input_schema).toMatchObject({
      properties: {
        resource_profile: { enum: ['micro', 'small', 'medium', 'large', 'custom'] },
        memory_mb: { type: 'integer', minimum: 64 },
      },
    });
  });

  it.each(['postgres', 'mysql', 'redis', 'mongo', 'neo4j', 'minio'])(
    'reads the actual %s memory limit by name',
    async (kind) => {
      const h = harness();
      h.service.kind = kind;
      expect(await h.call('get_service_resources', { service_name: 'pg' })).toMatchObject({
        status: 'ok',
        service_id: 'db-1',
        project_id: 'p-1',
        profile: 'custom',
        memory: { limitBytes: 512 * MB },
        running: true,
        _agent_guidance: { message: expect.any(String) },
      });
      expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
    },
  );

  it('applies custom memory through the shared pipeline and returns the verified limit', async () => {
    const h = harness({ source: 'mcp', mcpScopeKind: 'project', mcpScopeProjectId: 'p-1' });
    expect(
      await h.call('update_service_resources', paramsFor('update_service_resources')),
    ).toMatchObject({
      status: 'updated',
      memory: { limitBytes: 768 * MB },
      cpu: { shares: 512 },
      running: true,
      status_call: {
        tool: 'openlander_managed_service',
        arguments: { action: 'get_service_resources', params: { service_id: 'db-1' } },
      },
    });
    expect(h.runtime.updateContainerMemory).toHaveBeenCalledWith('container-1', 768 * MB);
    expect(
      deserializeConfig(h.db.saveDeployConfigForService.mock.calls[0]![1])?.snapshot,
    ).toMatchObject({ resourceProfile: 'custom', memoryLimitBytes: 768 * MB });
    expect(h.db.releaseDeployLock).toHaveBeenCalled();
  });

  it('applies a preset to a stopped DB and leaves it stopped', async () => {
    const h = harness();
    h.info.State.Running = false;
    expect(
      await h.call('update_service_resources', { service_name: 'pg', resource_profile: 'micro' }),
    ).toMatchObject({
      status: 'updated',
      profile: 'micro',
      memory: { limitBytes: 256 * MB },
      running: false,
    });
  });

  it('rejects running decreases through the same guard as the web UI', async () => {
    const h = harness();
    await expect(
      h.call('update_service_resources', { service_id: 'db-1', resource_profile: 'micro' }),
    ).rejects.toMatchObject({ code: 'SERVICE_CONTAINER_STATE_INVALID' });
    expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
    expect(h.db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { service_id: 'db-1' },
    { service_id: 'db-1', resource_profile: 'custom' },
    { service_id: 'db-1', resource_profile: 'custom', memory_mb: 63 },
    { service_id: 'db-1', resource_profile: 'custom', memory_mb: 256.5 },
    { service_id: 'db-1', resource_profile: 'small', memory_mb: 512 },
    { service_id: 'db-1', resource_profile: 'unlimited' },
    { service_id: 'db-1', resource_profile: 'large', env_vars: { SECRET: 'ignored' } },
  ])('rejects invalid inputs before touching the service: %j', async (params) => {
    const h = harness();
    expect(await h.call('update_service_resources', params)).toMatchObject({
      error: 'INVALID_PARAMS',
    });
    expect(h.manager.updateResourceLimits).not.toHaveBeenCalled();
  });

  it.each(actions)('%s rejects Application targets', async (action) => {
    const h = harness();
    h.service.kind = 'git';
    expect(await h.call(action, paramsFor(action))).toMatchObject({
      code: 'SERVICE_KIND_MISMATCH',
    });
    expect(h.runtime.inspectContainer).not.toHaveBeenCalled();
  });

  it.each(actions)('%s checks every supplied selector against project scope', async (action) => {
    const h = harness({ source: 'mcp', mcpScopeKind: 'project', mcpScopeProjectId: 'p-1' });
    for (const selectors of [
      { service_id: 'db-2' },
      { service_name: 'other-pg' },
      { service_id: 'db-1', service_name: 'other-pg' },
      { service_id: 'db-1', service_name: 'missing' },
      { service_id: 'missing' },
    ]) {
      expect(
        await h.call(action, {
          ...(action === 'update_service_resources' ? { resource_profile: 'large' } : {}),
          ...selectors,
        }),
      ).toMatchObject({ code: 'SCOPE_VIOLATION' });
    }
    expect(h.runtime.inspectContainer).not.toHaveBeenCalled();
    expect(h.manager.updateResourceLimits).not.toHaveBeenCalled();
  });

  it.each(actions)(
    '%s accepts only the exact service for a service-scoped token',
    async (action) => {
      const h = harness({
        source: 'mcp',
        mcpScopeKind: 'service',
        mcpScopeServiceId: 'db-1',
        mcpScopeProjectId: 'p-1',
      });
      expect(
        await h.call(action, { ...paramsFor(action), service_name: 'sibling-pg' }),
      ).toMatchObject({ code: 'SCOPE_VIOLATION' });
      expect(h.runtime.inspectContainer).not.toHaveBeenCalled();
      expect(await h.call(action, paramsFor(action))).toMatchObject({ service_id: 'db-1' });
    },
  );

  it('propagates runtime failure without claiming success or persisting it', async () => {
    const h = harness();
    h.runtime.updateContainerMemory.mockRejectedValueOnce(new Error('Docker unavailable'));
    await expect(
      h.call('update_service_resources', paramsFor('update_service_resources')),
    ).rejects.toThrow('Docker unavailable');
    expect(h.db.saveDeployConfigForService).not.toHaveBeenCalled();
    expect(h.db.releaseDeployLock).toHaveBeenCalled();
  });
});
