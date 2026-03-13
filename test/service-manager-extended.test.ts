import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, ServiceRow } from '../src/db/index.js';
import { ServiceManager } from '../src/pipeline/service-manager.js';
import { createMockDockerHarness } from './helpers/docker-mocks.js';

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
    credentials:
      partial.credentials ??
      JSON.stringify({
        user: 'openlander',
        password: 'rootpw',
        database: 'openlander',
      }),
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

function createDbMock(services: ServiceRow[]): Database {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return {
    getService: vi.fn((id: string) => byId.get(id) ?? null),
  } as unknown as Database;
}

describe('ServiceManager extended DB/user operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createDatabase() creates postgres DB via mocked docker exec', async () => {
    const postgres = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      container_id: 'svc-pg-container',
      container_name: 'ol-svc-shared-pg',
      port: 5432,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', true);
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));
    const result = await manager.createDatabase('svc-pg', 'appdb');

    expect(result).toEqual({
      database: 'appdb',
      user: 'openlander',
      password: 'rootpw',
      connectionString: 'postgresql://openlander:rootpw@ol-svc-shared-pg:5432/appdb',
    });

    const commands = dockerHarness.getExecCommands('svc-pg-container');
    expect(commands[0]?.slice(0, 3)).toEqual(['pg_isready', '-U', 'openlander']);
    expect(commands[1]?.join(' ')).toContain('CREATE DATABASE "appdb"');
  });

  it('createUser() creates postgres user and grants DB permissions via mocked exec', async () => {
    const postgres = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      container_id: 'svc-pg-container',
      container_name: 'ol-svc-shared-pg',
      port: 5432,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', true);
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));
    const result = await manager.createUser('svc-pg', 'app_user', 'pw123', { database: 'appdb' });

    expect(result).toEqual({
      database: 'appdb',
      user: 'app_user',
      password: 'pw123',
      connectionString: 'postgresql://app_user:pw123@ol-svc-shared-pg:5432/appdb',
    });

    const commands = dockerHarness.getExecCommands('svc-pg-container');
    expect(commands).toHaveLength(3);
    expect(commands[1]?.join(' ')).toContain('CREATE ROLE "app_user" LOGIN PASSWORD');
    expect(commands[2]?.join(' ')).toContain(
      'GRANT ALL PRIVILEGES ON DATABASE "appdb" TO "app_user";',
    );
  });

  it('createDatabase() rejects redis service type', async () => {
    const redis = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      container_id: 'svc-redis-container',
      container_name: 'ol-svc-shared-redis',
      port: 6379,
      credentials: null,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-redis-container', true);
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));

    await expect(manager.createDatabase('svc-redis', 'cachedb')).rejects.toThrow(
      'Database creation is not supported for redis services',
    );
  });

  it('createUser() rejects redis service type', async () => {
    const redis = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      container_id: 'svc-redis-container',
      container_name: 'ol-svc-shared-redis',
      port: 6379,
      credentials: null,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-redis-container', true);
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));

    await expect(manager.createUser('svc-redis', 'cache_user')).rejects.toThrow(
      'User creation is not supported for redis services',
    );
  });

  it('createUser() returns service not found error for invalid service name/id', async () => {
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(manager.createUser('missing-service', 'app_user')).rejects.toThrow(
      'Service not found: missing-service',
    );
  });
});
