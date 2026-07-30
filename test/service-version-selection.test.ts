import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, ServiceRow } from '../src/db/index.js';
import { AVAILABLE_VERSIONS, ServiceManager } from '../src/pipeline/service-manager.js';
import { createMockDockerHarness } from './helpers/docker-mocks.js';

function createDbMock(services: ServiceRow[]): Database {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return {
    getService: vi.fn((id: string) => byId.get(id) ?? null),
    listServices: vi.fn(() => Array.from(byId.values())),
    createService: vi.fn((service: ServiceRow) => {
      byId.set(service.id, service);
      return service;
    }),
    deleteService: vi.fn((id: string) => {
      byId.delete(id);
    }),
    updateService: vi.fn(
      (id: string, updates: { status?: ServiceRow['status']; containerId?: string | null }) => {
        const current = byId.get(id);
        if (!current) {
          return;
        }

        byId.set(id, {
          ...current,
          status: updates.status ?? current.status,
          container_id: updates.containerId ?? current.container_id,
        });
      },
    ),
    getUsedPorts: vi.fn(() => Array.from(byId.values()).map((svc) => svc.port)),
  } as unknown as Database;
}

describe('AVAILABLE_VERSIONS constant', () => {
  it('should define versions for all service templates', () => {
    expect(AVAILABLE_VERSIONS).toBeDefined();
    expect(AVAILABLE_VERSIONS.postgresql).toBeDefined();
    expect(AVAILABLE_VERSIONS.mysql).toBeDefined();
    expect(AVAILABLE_VERSIONS.redis).toBeDefined();
    expect(AVAILABLE_VERSIONS.mongodb).toBeDefined();
  });

  it('should have array of strings for each template', () => {
    Object.entries(AVAILABLE_VERSIONS).forEach(([key, versions]) => {
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
      versions.forEach((version) => {
        expect(typeof version).toBe('string');
      });
    });
  });

  it('keeps PostgreSQL 17 as the default and offers PostgreSQL 18', () => {
    expect(AVAILABLE_VERSIONS.postgresql).toEqual([
      '17-alpine',
      '18-alpine',
      '16-alpine',
      '15-alpine',
      '14-alpine',
    ]);
  });

  it('mysql should have 2 versions with latest first', () => {
    expect(AVAILABLE_VERSIONS.mysql).toEqual(['9', '8']);
  });

  it('redis should have 2 versions with latest first', () => {
    expect(AVAILABLE_VERSIONS.redis).toEqual(['8-alpine', '7-alpine']);
  });

  it('mongodb should have 2 versions with latest first', () => {
    expect(AVAILABLE_VERSIONS.mongodb).toEqual(['8', '7']);
  });
});

describe('ServiceManager.create() with version selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use default version (first in array) when version is omitted', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-pg',
      template: 'postgresql',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('postgres:17-alpine');
    expect(runCall?.[0]?.volumeBinds).toEqual(['ol-svc-data-test-pg:/var/lib/postgresql/data']);
  });

  it('should override image tag when specific version is provided', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-pg-15',
      template: 'postgresql',
      version: '15-alpine',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('postgres:15-alpine');
  });

  it('mounts PostgreSQL 18 at the image-declared persistent root', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-pg-18',
      template: 'postgresql',
      version: '18-alpine',
    });

    expect(dockerHarness.docker.runServiceContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'postgres:18-alpine',
        volumeBinds: ['ol-svc-data-test-pg-18:/var/lib/postgresql'],
      }),
    );
  });

  it('rejects an unknown PostgreSQL volume contract before creating storage', async () => {
    const dockerHarness = createMockDockerHarness();
    (dockerHarness.docker.inspectImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      Config: {
        Env: ['PGDATA=/data/postgres'],
        Volumes: { '/data': {} },
      },
    });
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(
      manager.create({
        name: 'custom-pg',
        template: 'postgresql',
        image: 'ghcr.io/example/custom-postgres:latest',
      }),
    ).rejects.toMatchObject({ code: 'MANAGED_POSTGRES_VOLUME_CONTRACT_UNSUPPORTED' });

    expect(dockerHarness.docker.createVolume).not.toHaveBeenCalled();
    expect(dockerHarness.docker.runServiceContainer).not.toHaveBeenCalled();
  });

  it('should use first version for mysql when version is omitted', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-mysql',
      template: 'mysql',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('mysql:9');
  });

  it('should override mysql version when specified', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-mysql-8',
      template: 'mysql',
      version: '8',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('mysql:8');
  });

  it('should use first version for redis when version is omitted', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-redis',
      template: 'redis',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('redis:8-alpine');
  });

  it('should override redis version when specified', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-redis-7',
      template: 'redis',
      version: '7-alpine',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('redis:7-alpine');
  });

  it('should use first version for mongodb when version is omitted', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-mongo',
      template: 'mongodb',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('mongo:8');
  });

  it('should override mongodb version when specified', async () => {
    const dockerHarness = createMockDockerHarness();
    const db = createDbMock([]);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.create({
      name: 'test-mongo-7',
      template: 'mongodb',
      version: '7',
    });

    const runCall = (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(runCall).toBeDefined();
    expect(runCall?.[0]?.imageTag).toBe('mongo:7');
  });
});
