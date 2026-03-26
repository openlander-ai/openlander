import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Database as DatabaseType, ServiceRow } from '../src/db/index.js';
import { Database } from '../src/db/index.js';
import { getPolicy, SHARED_NETWORK_NAME } from '../src/config/index.js';
import { EnvManager } from '../src/pipeline/env.js';
import { autoInjectServiceEnv, cleanupAutoInjectedEnv } from '../src/pipeline/env-inject.js';
import { ServiceManager } from '../src/pipeline/service-manager.js';

function createService(partial: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-pg',
    type: partial.type ?? 'postgresql',
    image: partial.image ?? 'postgres:16-alpine',
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'svc-1-container',
    container_name: partial.container_name ?? 'ol-svc-shared-pg',
    port: partial.port ?? 5432,
    env_vars: partial.env_vars ?? null,
    credentials: partial.credentials ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('getPolicy shared network', () => {
  it('production returns openlander network', () => {
    expect(getPolicy('production').networkName).toBe(SHARED_NETWORK_NAME);
  });

  it('development returns openlander network', () => {
    expect(getPolicy('development').networkName).toBe(SHARED_NETWORK_NAME);
  });

  it('port ranges unchanged for production', () => {
    const policy = getPolicy('production');
    expect(policy.portRangeStart).toBe(10001);
    expect(policy.portRangeEnd).toBe(10999);
  });

  it('port ranges unchanged for development', () => {
    const policy = getPolicy('development');
    expect(policy.portRangeStart).toBe(20001);
    expect(policy.portRangeEnd).toBe(20999);
  });
});

describe('Service Connections', () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ol-network-svc-connections-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a connection between project and service', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-shared-pg',
      port: 5432,
    });

    const created = db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg' });

    expect(created.project_id).toBe('p1');
    expect(created.service_id).toBe('svc-pg');
    expect(created.id.length).toBeGreaterThan(0);
  });

  it('rejects duplicate connection with UNIQUE constraint', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-shared-pg',
      port: 5432,
    });
    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg' });

    expect(() => {
      db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg' });
    }).toThrow(/UNIQUE constraint failed/);
  });

  it('lists connections by project', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-shared-pg',
      port: 5432,
    });
    db.createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      containerName: 'ol-svc-shared-redis',
      port: 6379,
    });

    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg' });
    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-redis' });

    const connections = db.listServiceConnectionsByProject('p1');
    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.service_id).sort()).toEqual(['svc-pg', 'svc-redis']);
  });

  it('lists connections by service', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createProject({ id: 'p2', name: 'proj-2', repoUrl: 'https://github.com/acme/proj-2' });
    db.createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      containerName: 'ol-svc-shared-redis',
      port: 6379,
    });

    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-redis' });
    db.createServiceConnection({ projectId: 'p2', serviceId: 'svc-redis' });

    const connections = db.listServiceConnectionsByService('svc-redis');
    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.project_id).sort()).toEqual(['p1', 'p2']);
  });

  it('deletes connection by composite key', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-shared-pg',
      port: 5432,
    });

    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg' });
    db.deleteServiceConnectionByProjectAndService('p1', 'svc-pg');

    expect(db.getServiceConnectionByProjectAndService('p1', 'svc-pg')).toBeUndefined();
  });

  it('cascade deletes connections when service is deleted', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      containerName: 'ol-svc-shared-redis',
      port: 6379,
    });
    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-redis' });

    db.deleteService('svc-redis');

    expect(db.listServiceConnectionsByProject('p1')).toHaveLength(0);
  });

  it('cascade deletes connections when project is deleted', () => {
    db.createProject({ id: 'p1', name: 'proj-1', repoUrl: 'https://github.com/acme/proj-1' });
    db.createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      containerName: 'ol-svc-shared-redis',
      port: 6379,
    });
    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-redis' });

    db.deleteProject('p1');

    expect(db.listServiceConnectionsByService('svc-redis')).toHaveLength(0);
  });
});

describe('Auto env injection', () => {
  let tmpDir: string;
  let db: Database;
  let env: EnvManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ol-network-svc-env-inject-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);
    db.createProject({
      id: 'p1',
      name: 'proj-1',
      repoUrl: 'https://github.com/acme/proj-1',
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('injects DATABASE_URL for postgres service', () => {
    const keys = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-pg',
      serviceName: 'shared-pg',
      serviceType: 'postgresql',
      containerName: 'ol-svc-shared-pg',
    });

    expect(keys).toEqual(['DATABASE_URL']);
    expect(env.getAll('p1').DATABASE_URL).toBe('postgresql://postgres:postgres@shared-pg:5432/app');
  });

  it('injects REDIS_URL for redis service', () => {
    const keys = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-redis',
      serviceName: 'shared-redis',
      serviceType: 'redis',
      containerName: 'ol-svc-shared-redis',
    });

    expect(keys).toEqual(['REDIS_URL']);
    expect(env.getAll('p1').REDIS_URL).toBe('redis://shared-redis:6379');
  });

  it('uses service name as hostname in env value', () => {
    const value = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-pg',
      serviceName: 'analytics-db',
      serviceType: 'postgresql',
      containerName: 'ol-svc-analytics-db',
    });

    expect(value).toEqual(['DATABASE_URL']);
    const vars = env.getAll('p1');
    expect(vars.DATABASE_URL).toContain('@analytics-db:5432');
    expect(vars.DATABASE_URL).not.toContain('ol-svc-analytics-db');
  });

  it('does not overwrite user-set env var', () => {
    env.set('p1', 'DATABASE_URL', 'postgresql://custom-user:pw@custom:5432/app');

    const keys = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-pg',
      serviceName: 'shared-pg',
      serviceType: 'postgresql',
      containerName: 'ol-svc-shared-pg',
    });

    expect(keys).toEqual([]);
    expect(env.getAll('p1').DATABASE_URL).toBe('postgresql://custom-user:pw@custom:5432/app');
  });

  it('suffixes key for same-type duplicate connection', () => {
    db.createService({
      id: 'svc-pg-1',
      name: 'primary-db',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-primary-db',
      port: 5432,
    });
    db.createService({
      id: 'svc-pg-2',
      name: 'analytics-db',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      containerName: 'ol-svc-analytics-db',
      port: 5432,
    });
    db.createServiceConnection({ projectId: 'p1', serviceId: 'svc-pg-1' });

    const keys = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-pg-2',
      serviceName: 'analytics-db',
      serviceType: 'postgresql',
      containerName: 'ol-svc-analytics-db',
    });

    expect(keys).toEqual(['DATABASE_URL_ANALYTICS_DB']);
    expect(env.getAll('p1').DATABASE_URL_ANALYTICS_DB).toBe(
      'postgresql://postgres:postgres@analytics-db:5432/app',
    );
  });

  it('returns empty array for unknown service type', () => {
    const keys = autoInjectServiceEnv({
      db,
      env,
      projectId: 'p1',
      serviceId: 'svc-custom',
      serviceName: 'my-custom-service',
      serviceType: 'custom',
      containerName: 'ol-svc-my-custom-service',
    });

    expect(keys).toEqual([]);
  });
});

describe('Auto env cleanup on disconnect', () => {
  let tmpDir: string;
  let db: Database;
  let env: EnvManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ol-network-svc-env-cleanup-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);
    db.createProject({
      id: 'p1',
      name: 'proj-1',
      repoUrl: 'https://github.com/acme/proj-1',
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes only auto-injected env vars', () => {
    env.set('p1', 'DATABASE_URL', 'postgresql://postgres:postgres@shared-pg:5432/app');
    env.set('p1', 'REDIS_URL', 'redis://shared-redis:6379');
    env.set('p1', 'USER_DEFINED', 'keep-me');

    cleanupAutoInjectedEnv({
      db,
      env,
      projectId: 'p1',
      autoInjectedEnvKeys: ['DATABASE_URL', 'REDIS_URL'],
    });

    const vars = env.getAll('p1');
    expect(vars.DATABASE_URL).toBeUndefined();
    expect(vars.REDIS_URL).toBeUndefined();
    expect(vars.USER_DEFINED).toBe('keep-me');
  });

  it('preserves user-set env vars', () => {
    env.set('p1', 'DATABASE_URL', 'postgresql://custom:custom@custom-db:5432/app');

    cleanupAutoInjectedEnv({
      db,
      env,
      projectId: 'p1',
      autoInjectedEnvKeys: ['REDIS_URL'],
    });

    expect(env.getAll('p1').DATABASE_URL).toBe('postgresql://custom:custom@custom-db:5432/app');
  });

  it('handles empty auto_injected_env_keys gracefully', () => {
    env.set('p1', 'KEEP_ME', '1');

    cleanupAutoInjectedEnv({
      db,
      env,
      projectId: 'p1',
      autoInjectedEnvKeys: [],
    });

    expect(env.getAll('p1').KEEP_ME).toBe('1');
  });
});

describe('reconcileServiceNetworks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls network.connect for services not on shared network', async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const service = createService({
      id: 'svc-migrate',
      name: 'shared-pg',
      container_id: 'svc-migrate-container',
    });

    const client = {
      getContainer: () => ({
        inspect: async () => ({
          Id: 'container-123',
          State: { Running: true },
          NetworkSettings: { Networks: {} },
        }),
      }),
      getNetwork: () => ({ connect, disconnect }),
    };

    const docker = { getClient: () => client };
    const db = { listServices: () => [service] };
    const manager = new ServiceManager(
      docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
      db as unknown as DatabaseType,
    );

    await manager.reconcileServiceNetworks();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      Container: 'container-123',
      EndpointConfig: { Aliases: ['shared-pg'] },
    });
  });

  it('skips services already connected with correct alias', async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const service = createService({
      id: 'svc-already',
      name: 'shared-pg',
      container_id: 'svc-already-container',
    });

    const client = {
      getContainer: () => ({
        inspect: async () => ({
          Id: 'container-abc',
          State: { Running: true },
          NetworkSettings: {
            Networks: {
              [SHARED_NETWORK_NAME]: {
                Aliases: ['shared-pg'],
              },
            },
          },
        }),
      }),
      getNetwork: () => ({ connect, disconnect }),
    };

    const docker = { getClient: () => client };
    const db = { listServices: () => [service] };
    const manager = new ServiceManager(
      docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
      db as unknown as DatabaseType,
    );

    await manager.reconcileServiceNetworks();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('handles missing containers gracefully', async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const service = createService({
      id: 'svc-missing',
      name: 'shared-pg',
      container_id: 'svc-missing-container',
    });

    const client = {
      getContainer: () => ({
        inspect: async () => {
          throw new Error('No such container: svc-missing-container');
        },
      }),
      getNetwork: () => ({ connect, disconnect }),
    };

    const docker = { getClient: () => client };
    const db = { listServices: () => [service] };
    const manager = new ServiceManager(
      docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
      db as unknown as DatabaseType,
    );

    await expect(manager.reconcileServiceNetworks()).resolves.toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });

  it('handles stopped containers gracefully', async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const service = createService({
      id: 'svc-stopped',
      name: 'shared-pg',
      container_id: 'svc-stopped-container',
    });

    const client = {
      getContainer: () => ({
        inspect: async () => ({
          Id: 'container-stopped',
          State: { Running: false },
          NetworkSettings: { Networks: {} },
        }),
      }),
      getNetwork: () => ({ connect, disconnect }),
    };

    const docker = { getClient: () => client };
    const db = { listServices: () => [service] };
    const manager = new ServiceManager(
      docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
      db as unknown as DatabaseType,
    );

    await manager.reconcileServiceNetworks();

    expect(connect).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('logs summary with migrated and already-connected counts', async () => {
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);

    const svcMigrated = createService({
      id: 'svc-migrate',
      name: 'migrate-db',
      container_id: 'svc-migrate-container',
    });
    const svcAlready = createService({
      id: 'svc-already',
      name: 'already-db',
      container_id: 'svc-already-container',
    });

    const client = {
      getContainer: (containerRef: string) => ({
        inspect: async () => {
          if (containerRef === 'svc-migrate-container') {
            return {
              Id: 'container-migrate',
              State: { Running: true },
              NetworkSettings: { Networks: {} },
            };
          }
          return {
            Id: 'container-already',
            State: { Running: true },
            NetworkSettings: {
              Networks: {
                [SHARED_NETWORK_NAME]: {
                  Aliases: ['already-db'],
                },
              },
            },
          };
        },
      }),
      getNetwork: () => ({ connect, disconnect }),
    };

    const docker = { getClient: () => client };
    const db = { listServices: () => [svcMigrated, svcAlready] };
    const manager = new ServiceManager(
      docker as unknown as ConstructorParameters<typeof ServiceManager>[0],
      db as unknown as DatabaseType,
    );

    await manager.reconcileServiceNetworks();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        Container: 'container-migrate',
        EndpointConfig: { Aliases: ['migrate-db'] },
      }),
    );
    expect(disconnect).not.toHaveBeenCalled();
  });
});
