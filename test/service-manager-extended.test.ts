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
    listServices: vi.fn(() => Array.from(byId.values())),
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

  it('listDatabases() parses postgres machine-readable output', async () => {
    const postgres = createService({
      id: 'svc-pg',
      type: 'postgresql',
      container_id: 'svc-pg-container',
      container_name: 'ol-svc-shared-pg',
      port: 5432,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', true);
    dockerHarness.queueExecResult('svc-pg-container', { exitCode: 0 });
    dockerHarness.queueExecResult('svc-pg-container', {
      exitCode: 0,
      stdout: 'hotdeal_db|1234567\nusers_db|8901234\n',
    });

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));

    await expect(manager.listDatabases('svc-pg')).resolves.toEqual([
      { name: 'hotdeal_db', sizeBytes: 1234567 },
      { name: 'users_db', sizeBytes: 8901234 },
    ]);

    const commands = dockerHarness.getExecCommands('svc-pg-container');
    expect(commands[1]).toEqual([
      'psql',
      '-t',
      '-A',
      '-F',
      '|',
      '-U',
      'openlander',
      '-d',
      'postgres',
      '-c',
      'SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false',
    ]);
  });

  it('listUsers() parses mysql machine-readable output', async () => {
    const mysql = createService({
      id: 'svc-mysql',
      type: 'mysql',
      image: 'mysql:8',
      container_id: 'svc-mysql-container',
      container_name: 'ol-svc-shared-mysql',
      port: 3306,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-mysql-container', true);
    dockerHarness.queueExecResult('svc-mysql-container', { exitCode: 0 });
    dockerHarness.queueExecResult('svc-mysql-container', {
      exitCode: 0,
      stdout: 'app_user\nreporting_user\n',
    });

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([mysql]));

    await expect(manager.listUsers('svc-mysql')).resolves.toEqual([
      { name: 'app_user' },
      { name: 'reporting_user' },
    ]);

    const commands = dockerHarness.getExecCommands('svc-mysql-container');
    expect(commands[1]).toEqual([
      'mysql',
      '-N',
      '-uroot',
      '-prootpw',
      '-e',
      "SELECT user FROM mysql.user WHERE user NOT IN ('root','mysql.sys','mysql.infoschema','mysql.session')",
    ]);
  });

  it('listDatabases() rejects redis service type', async () => {
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

    await expect(manager.listDatabases('svc-redis')).rejects.toThrow(
      'Database listing is not supported for redis services',
    );
  });

  it('listUsers() rejects redis service type', async () => {
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

    await expect(manager.listUsers('svc-redis')).rejects.toThrow(
      'User listing is not supported for redis services',
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

describe('ServiceManager detail/log/stats operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getDetail() refreshes service status using container inspect', async () => {
    const service = createService({
      id: 'svc-pg',
      status: 'stopped',
      container_id: 'svc-pg-container',
    });
    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', true);
    const db = createDbMock([service]);

    const manager = new ServiceManager(dockerHarness.docker, db);
    const detail = await manager.getDetail('svc-pg');

    expect(detail.status).toBe('running');
    expect(detail.container_id).toBe('svc-pg-container');
    expect(db.updateService).toHaveBeenCalledWith('svc-pg', {
      status: 'running',
      containerId: 'svc-pg-container',
    });
  });

  it('getDetail() throws when service does not exist', async () => {
    const manager = new ServiceManager(createMockDockerHarness().docker, createDbMock([]));

    await expect(manager.getDetail('missing')).rejects.toThrow('Service not found: missing');
  });

  it('getLogs() fetches container logs with requested line count', async () => {
    const service = createService({ id: 'svc-log', container_id: 'svc-log-container' });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.docker.getLogs = vi.fn().mockResolvedValue('line-a\nline-b');
    const manager = new ServiceManager(dockerHarness.docker, db);

    const logs = await manager.getLogs('svc-log', 10);

    expect(logs).toBe('line-a\nline-b');
    expect(dockerHarness.docker.getLogs).toHaveBeenCalledWith('svc-log-container', 10);
  });

  it('getStats() returns disk usage bytes for running services', async () => {
    const service = createService({
      id: 'svc-stats',
      type: 'postgresql',
      status: 'running',
      container_id: 'svc-stats-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-stats-container', true);
    dockerHarness.queueExecResult('svc-stats-container', {
      exitCode: 0,
      stdout: '4096\t/var/lib/postgresql/data\n',
    });
    const manager = new ServiceManager(dockerHarness.docker, db);

    const stats = await manager.getStats('svc-stats');

    expect(stats).toEqual({
      status: 'running',
      diskUsageBytes: 4096,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
    });
    const commands = dockerHarness.getExecCommands('svc-stats-container');
    expect(commands[0]).toEqual(['du', '-sb', '/var/lib/postgresql/data']);
  });

  it('getStats() returns null disk usage when service is stopped', async () => {
    const service = createService({
      id: 'svc-stopped',
      type: 'redis',
      status: 'running',
      container_id: 'svc-stopped-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-stopped-container', false);
    const manager = new ServiceManager(dockerHarness.docker, db);

    const stats = await manager.getStats('svc-stopped');

    expect(stats).toEqual({
      status: 'stopped',
      diskUsageBytes: null,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
    });
    expect(dockerHarness.getExecCommands('svc-stopped-container')).toEqual([]);
  });
});
