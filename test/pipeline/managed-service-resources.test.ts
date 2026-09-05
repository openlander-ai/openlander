import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { Database } from '../../src/db/index.js';
import { deserializeConfig, serializeConfig } from '../../src/pipeline/config-snapshot.js';
import {
  getManagedServiceResources,
  updateManagedServiceResources,
} from '../../src/pipeline/managed-service-resources.js';
import { recover } from '../../src/pipeline/recover.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

const MB = 1024 * 1024;

function harness() {
  const service = {
    id: 'db-1',
    project_id: 'p-1',
    name: 'pg',
    kind: 'postgres',
    container_id: 'container-1',
    container_name: 'pg',
    status: 'running',
    archived_at: null,
  };
  const project = { id: 'p-1', name: 'test-project', archived_at: null };
  let config = serializeConfig({ environment: 'production' });
  const info = {
    Id: 'container-1',
    HostConfig: {
      Memory: 512 * MB,
      MemorySwap: 512 * MB,
      MemoryReservation: 256 * MB,
      CpuShares: 512,
    },
    State: { Running: true },
    Mounts: [{ Name: 'existing-data' }],
  };
  const db = {
    getService: vi.fn(async () => service),
    getProject: vi.fn(async () => project),
    isCircuitBreakerOpen: vi.fn(async () => false),
    acquireDeployLock: vi.fn(async () => true),
    releaseDeployLock: vi.fn(async () => undefined),
    getDeployLockInfo: vi.fn(async () => ({ session: 'other-operation' })),
    loadDeployConfigForService: vi.fn(async () => ({ config_json: config })),
    saveDeployConfigForService: vi.fn(async (_id: string, value: string) => {
      config = value;
    }),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const runtime = {
    inspectContainer: vi.fn(async () => structuredClone(info)),
    updateContainerMemory: vi.fn(async (_id: string, memory: number) => {
      info.HostConfig.Memory = memory;
      info.HostConfig.MemorySwap = memory;
      info.HostConfig.MemoryReservation = Math.floor(memory / 2);
    }),
    stopContainer: vi.fn(),
    safeRemoveContainer: vi.fn(),
    runServiceContainer: vi.fn(),
  };
  return {
    db,
    runtime,
    service,
    project,
    info,
    get: () =>
      getManagedServiceResources(
        db as unknown as Database,
        runtime as unknown as RuntimeBackend,
        service.id,
      ),
    update: (memoryMb: number) =>
      updateManagedServiceResources(
        db as unknown as Database,
        runtime as unknown as RuntimeBackend,
        service.id,
        { profile: 'custom', memoryMb },
      ),
  };
}

describe('managed service memory limits', () => {
  it.each(['postgres', 'mysql', 'redis', 'mongo', 'neo4j', 'minio'])(
    'supports the %s managed kind',
    async (kind) => {
      const h = harness();
      h.service.kind = kind;
      expect(await h.update(768)).toMatchObject({ memory: { limitBytes: 768 * MB } });
    },
  );
  it('reports the actual limit for an existing database with no saved profile', async () => {
    const h = harness();
    expect(await h.get()).toMatchObject({
      profile: 'custom',
      memory: { limitBytes: 512 * MB },
      running: true,
    });
  });

  it('increases memory in place, verifies it, and persists recovery settings', async () => {
    const h = harness();
    expect(await h.update(768)).toMatchObject({
      memory: { limitBytes: 768 * MB },
      cpu: { shares: 512 },
    });
    expect(h.runtime.updateContainerMemory).toHaveBeenCalledWith('container-1', 768 * MB);
    expect(
      deserializeConfig(h.db.saveDeployConfigForService.mock.calls[0][1])?.snapshot,
    ).toMatchObject({
      environment: 'production',
      resourceProfile: 'custom',
      memoryLimitBytes: 768 * MB,
    });
    expect(h.runtime.safeRemoveContainer).not.toHaveBeenCalled();
    expect(h.runtime.stopContainer).not.toHaveBeenCalled();
    expect(h.info.Mounts).toEqual([{ Name: 'existing-data' }]);
    expect(h.db.insertActivityLog).toHaveBeenCalledOnce();
    expect(h.db.releaseDeployLock).toHaveBeenCalledOnce();
  });

  it.each([128, 256])('rejects a running decrease to %i MB before any mutation', async (memory) => {
    const h = harness();
    await expect(h.update(memory)).rejects.toMatchObject({
      code: 'SERVICE_CONTAINER_STATE_INVALID',
    });
    expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
    expect(h.db.saveDeployConfigForService).not.toHaveBeenCalled();
    expect(h.db.releaseDeployLock).toHaveBeenCalledOnce();
  });

  it('requires stopping an unlimited container before imposing a limit', async () => {
    const h = harness();
    h.info.HostConfig.Memory = 0;
    await expect(h.update(768)).rejects.toMatchObject({ code: 'SERVICE_CONTAINER_STATE_INVALID' });
  });

  it('allows a stopped database to decrease without starting it', async () => {
    const h = harness();
    h.info.State.Running = false;
    expect(await h.update(256)).toMatchObject({ running: false, memory: { limitBytes: 256 * MB } });
    expect(h.runtime.runServiceContainer).not.toHaveBeenCalled();
  });

  it.each([0, 32, 64.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid memory %s',
    async (memory) => {
      const h = harness();
      await expect(h.update(memory)).rejects.toMatchObject({ code: 'SERVICE_CONFIG_INVALID' });
      expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
    },
  );

  it('awaits the circuit breaker policy before changing Docker', async () => {
    const h = harness();
    h.db.isCircuitBreakerOpen.mockResolvedValue(true);
    await expect(h.update(768)).rejects.toMatchObject({ code: 'CIRCUIT_BREAKER_OPEN' });
    expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
  });

  it('rejects archived projects and competing operations', async () => {
    const h = harness();
    Object.assign(h.project, { archived_at: '2026-09-05' });
    await expect(h.update(768)).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    h.db.acquireDeployLock.mockResolvedValue(false);
    await expect(h.update(768)).rejects.toMatchObject({ code: 'DEPLOY_LOCKED' });
    expect(h.runtime.updateContainerMemory).not.toHaveBeenCalled();
  });

  it('does not persist or claim success when Docker rejects the update', async () => {
    const h = harness();
    h.runtime.updateContainerMemory.mockRejectedValue(new Error('Docker unavailable'));
    await expect(h.update(768)).rejects.toThrow('Docker unavailable');
    expect(h.db.saveDeployConfigForService).not.toHaveBeenCalled();
    expect(h.db.insertActivityLog).not.toHaveBeenCalled();
  });

  it('detects a Docker update that did not apply the requested values', async () => {
    const h = harness();
    h.runtime.updateContainerMemory.mockResolvedValue(undefined);
    await expect(h.update(768)).rejects.toMatchObject({ code: 'SERVICE_OPERATION_FAILED' });
    expect(h.db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it('reports persistence failure without undoing a live increase', async () => {
    const h = harness();
    h.db.saveDeployConfigForService.mockRejectedValue(new Error('Database unavailable'));
    await expect(h.update(768)).rejects.toMatchObject({
      code: 'SERVICE_OPERATION_FAILED',
      details: { applied_memory_bytes: 768 * MB },
    });
    expect(h.runtime.updateContainerMemory).toHaveBeenCalledOnce();
    expect(await h.get()).toMatchObject({ memory: { limitBytes: 768 * MB } });
    expect(h.db.insertActivityLog).not.toHaveBeenCalled();
  });

  it('reports out-of-band values instead of stale saved settings', async () => {
    const h = harness();
    await h.update(768);
    h.info.HostConfig.Memory = 1024 * MB;
    expect(await h.get()).toMatchObject({ profile: 'custom', memory: { limitBytes: 1024 * MB } });
  });

  it('does not treat missing inspection data as unlimited', async () => {
    const h = harness();
    Object.assign(h.info.HostConfig, { Memory: undefined });
    await expect(h.get()).rejects.toMatchObject({ code: 'SERVICE_CONTAINER_STATE_INVALID' });
  });

  it('rejects application targets and missing containers', async () => {
    const h = harness();
    h.service.kind = 'image';
    await expect(h.update(768)).rejects.toMatchObject({ code: 'SERVICE_OPERATION_UNSUPPORTED' });
    h.service.kind = 'postgres';
    Object.assign(h.service, { container_id: null, container_name: null });
    await expect(h.update(768)).rejects.toMatchObject({ code: 'SERVICE_CONTAINER_STATE_INVALID' });
  });

  it('reuses the saved memory limit when a database container must be recovered', async () => {
    const h = harness();
    await h.update(768);
    const docker = {
      getNetworkName: () => 'test',
      getNetworkInfo: vi.fn(async () => ({})),
      inspectContainer: vi.fn(async () => {
        throw new Error('missing');
      }),
      listVolumes: vi.fn(async () => [{ Name: 'ol-vol-pg' }]),
      createVolume: vi.fn(),
      inspectImage: vi.fn(async () => ({})),
      safeRemoveContainer: vi.fn(),
      ensureProjectNetwork: vi.fn(async () => 'test-project'),
      runServiceContainer: vi.fn(async () => 'recovered'),
    };
    const db = {
      ...h.db,
      listServices: vi.fn(async () => [
        { ...h.service, image_url: 'postgres:16-alpine', assigned_port: 15432 },
      ]),
      listProjects: vi.fn(async () => []),
      updateService: vi.fn(),
    };
    const result = await recover({ db, docker } as unknown as AppContext);
    expect(result.services[0]).toMatchObject({ status: 'recreated' });
    expect(docker.runServiceContainer).toHaveBeenCalledWith(
      expect.objectContaining({ memoryLimitBytes: 768 * MB, cpuShares: 512 }),
    );
  });
});
