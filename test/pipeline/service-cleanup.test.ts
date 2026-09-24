import { describe, expect, it, vi } from 'vitest';
import { DeployPipeline } from '../../src/pipeline/deploy-core.js';
import type { Database } from '../../src/db/index.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';
import type { CloudflareTunnelManager } from '../../src/pipeline/cloudflare.js';

function harness(compose = false) {
  const projects = new Map(
    ['group', 'app', 'child', 'sibling'].map((id) => [id, { id, name: id, archived_at: null }]),
  );
  const rows = [
    {
      id: 'app__svc',
      name: 'app',
      project_id: 'group',
      kind: compose ? 'compose' : 'git',
      container_id: compose ? null : 'app-container',
      parent_service_id: null,
      status: 'running',
      archived_at: null,
    },
    {
      id: 'sibling__svc',
      name: 'sibling',
      project_id: 'group',
      kind: 'git',
      container_id: 'sibling-container',
      parent_service_id: null,
      status: 'running',
      archived_at: null,
    },
    ...(compose
      ? [
          {
            id: 'child__svc',
            name: 'child',
            project_id: 'group',
            kind: 'compose-child',
            container_id: 'child-container',
            parent_service_id: 'app__svc',
            status: 'running',
            archived_at: null,
          },
        ]
      : []),
  ];
  const services = new Map(rows.map((s) => [s.id, s]));
  const settings = new Map<string, string>();
  const db = {
    getProject: vi.fn(async (id: string) => projects.get(id)),
    getService: vi.fn(async (id: string) => services.get(id)),
    listServices: vi.fn(async () => [...services.values()]),
    getDeployableForProject: vi.fn(async (id: string) => services.get(`${id}__svc`)),
    getDeployablesByGroup: vi.fn(async (id: string) =>
      [...services.values()].filter((s) => s.project_id === id),
    ),
    getComposeChildProjects: vi.fn(async () => []),
    isCircuitBreakerOpen: vi.fn(async () => false),
    acquireDeployLock: vi.fn(async () => true),
    getDeployLockInfo: vi.fn(async () => ({ session: 'other-deploy' })),
    releaseDeployLock: vi.fn(async () => {}),
    getSetting: vi.fn(async (key: string) =>
      settings.has(key) ? { value: settings.get(key)! } : null,
    ),
    listServiceConsumersForProvider: vi.fn(async () => [] as { service_id_consumer: string }[]),
    findProjectDependents: vi.fn(async () => []),
    getDomainMappingsForService: vi.fn(async () => []),
    deleteDomainMappingsByService: vi.fn(async () => {}),
    getEnvironmentsByServiceId: vi.fn(async () => []),
    deleteProjectDependenciesByService: vi.fn(async () => {}),
    updateService: vi.fn(async () => {}),
    updateEnvironment: vi.fn(async () => {}),
    deleteService: vi.fn(async (id: string) => {
      services.delete(id);
    }),
    deleteProject: vi.fn(async (id: string) => {
      projects.delete(id);
    }),
  };
  const runtime = {
    stopContainer: vi.fn(async () => {}),
    removeContainer: vi.fn(async () => {}),
    removeProjectNetwork: vi.fn(async () => {}),
    removeVolume: vi.fn(),
    listVolumes: vi.fn(),
  };
  const cloudflare = {
    deleteConnectedPublishReservation: vi.fn(async () => {}),
    removeTunnelForService: vi.fn(async () => {}),
  };
  const lifecycle = { stop: vi.fn(async () => {}) };
  // Exercise the real pipeline boundary with deterministic runtime dependencies.
  const pipeline = Object.assign(Object.create(DeployPipeline.prototype) as DeployPipeline, {
    db: db as unknown as Database,
    runtime: runtime as unknown as RuntimeBackend,
    lifecycle,
  });
  return {
    pipeline,
    cloudflare: cloudflare as unknown as CloudflareTunnelManager,
    db,
    runtime,
    services,
    projects,
    settings,
    lifecycle,
  };
}

describe('service cleanup pipeline boundary', () => {
  it('deletes only the selected service and runtime while retaining volumes and siblings', async () => {
    const h = harness();
    await expect(h.pipeline.deleteService('app__svc', h.cloudflare)).resolves.toMatchObject({
      status: 'deleted',
      volumes: { preserved: true },
    });
    expect([...h.services.keys()]).toEqual(['sibling__svc']);
    expect(h.projects.has('group')).toBe(true);
    expect(h.projects.has('sibling')).toBe(true);
    expect(h.runtime.removeContainer).toHaveBeenCalledExactlyOnceWith('app-container');
    expect(h.runtime.removeVolume).not.toHaveBeenCalled();
    expect(h.db.acquireDeployLock).toHaveBeenCalledTimes(2);
    expect(h.db.releaseDeployLock).toHaveBeenCalledTimes(2);
  });

  it('rejects an active deploy lock before touching runtime', async () => {
    const h = harness();
    h.db.acquireDeployLock.mockResolvedValue(false);
    await expect(h.pipeline.deleteService('app__svc', h.cloudflare)).rejects.toMatchObject({
      code: 'DEPLOY_LOCKED',
    });
    expect(h.runtime.stopContainer).not.toHaveBeenCalled();
    expect(h.db.deleteService).not.toHaveBeenCalled();
  });

  it('rejects dependent services before any removal', async () => {
    const h = harness();
    h.db.listServiceConsumersForProvider.mockResolvedValue([
      { service_id_consumer: 'sibling__svc' },
    ]);
    await expect(h.pipeline.deleteService('app__svc', h.cloudflare)).rejects.toMatchObject({
      code: 'SERVICE_HAS_CONSUMERS',
    });
    expect(h.runtime.removeContainer).not.toHaveBeenCalled();
    expect(h.db.deleteService).not.toHaveBeenCalled();
  });

  it('propagates runtime failure and releases locks without deleting the database row', async () => {
    const h = harness();
    h.runtime.removeContainer.mockRejectedValue(new Error('Docker unavailable'));
    await expect(h.pipeline.deleteService('app__svc', h.cloudflare)).rejects.toThrow(
      'Docker unavailable',
    );
    expect(h.db.deleteService).not.toHaveBeenCalled();
    expect(h.db.releaseDeployLock).toHaveBeenCalledTimes(2);
  });

  it('removes Compose children before their parent and preserves sibling workloads', async () => {
    const h = harness(true);
    await h.pipeline.deleteService('app__svc', h.cloudflare);
    expect(h.db.deleteService.mock.calls.map((call) => call[0])).toEqual([
      'child__svc',
      'app__svc',
    ]);
    expect([...h.services.keys()]).toEqual(['sibling__svc']);
    expect(h.runtime.removeContainer).toHaveBeenCalledExactlyOnceWith('child-container');
    expect(h.runtime.removeVolume).not.toHaveBeenCalled();
  });

  it('preflights child permission before deleting any part of Compose', async () => {
    const h = harness(true);
    h.settings.set(
      'security.operation_permissions.service.child__svc',
      JSON.stringify({ destructive_actions: 'block' }),
    );
    await expect(h.pipeline.deleteService('app__svc', h.cloudflare)).rejects.toMatchObject({
      code: 'OPERATION_PERMISSION_DENIED',
    });
    expect(h.runtime.removeContainer).not.toHaveBeenCalled();
    expect(h.db.deleteService).not.toHaveBeenCalled();
  });

  it('stops through the locked pipeline and rechecks persisted permission', async () => {
    const h = harness();
    await h.pipeline.stopService('app__svc');
    expect(h.runtime.stopContainer).toHaveBeenCalledExactlyOnceWith('app-container');
    expect(h.db.updateService).toHaveBeenCalledExactlyOnceWith('app__svc', { status: 'stopped' });
    h.settings.set(
      'security.operation_permissions.project.group',
      JSON.stringify({ destructive_actions: 'block' }),
    );
    await expect(h.pipeline.stopService('app__svc')).rejects.toMatchObject({
      code: 'OPERATION_PERMISSION_DENIED',
    });
    expect(h.runtime.stopContainer).toHaveBeenCalledTimes(1);
  });
});
