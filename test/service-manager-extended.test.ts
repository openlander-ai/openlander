import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServiceManagerLogger } = vi.hoisted(() => ({
  mockServiceManagerLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => mockServiceManagerLogger),
}));

import type { Database, ServiceRow } from '../src/db/index.js';
import { ServiceManager } from '../src/pipeline/service-manager.js';
import { createMockDockerHarness } from './helpers/docker-mocks.js';

function createService(partial: Partial<ServiceRow>): ServiceRow {
  const legacyType = partial.type ?? 'postgresql';
  // Map legacy type to canonical kind so production code (which reads kind ?? 'unknown')
  // resolves the correct adapter instead of falling back to 'unknown'.
  const typeToKind: Record<string, ServiceRow['kind']> = {
    postgresql: 'postgres',
    postgres: 'postgres',
    mysql: 'mysql',
    redis: 'redis',
    mongo: 'mongo',
    minio: 'minio',
  };
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-pg',
    type: legacyType,
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
    kind: partial.kind ?? typeToKind[legacyType] ?? 'postgres',
    image_url: partial.image_url ?? partial.image ?? 'postgres:16-alpine',
    assigned_port: partial.assigned_port ?? partial.port ?? 5432,
  };
}

function createDbMock(
  services: ServiceRow[],
  projects: Array<{ id: string; name: string }> = [],
  opts: {
    projectEnv?: Record<string, Record<string, string>>;
    serviceEnv?: Record<string, Record<string, string>>;
    deployablesByProject?: Record<string, ServiceRow[]>;
  } = {},
): Database {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return {
    getService: vi.fn((id: string) => byId.get(id) ?? null),
    listServices: vi.fn(() => Array.from(byId.values())),
    listProjects: vi.fn(() => projects),
    getEnvVars: vi.fn((projectId: string) => opts.projectEnv?.[projectId] ?? {}),
    getEnvVarsForService: vi.fn(
      (_projectId: string, serviceId: string) => opts.serviceEnv?.[serviceId] ?? {},
    ),
    getEnvironmentsByProject: vi.fn(() => []),
    getDeployablesByGroup: vi.fn(
      (projectId: string) => opts.deployablesByProject?.[projectId] ?? [],
    ),
    recordServiceMetricSample: vi.fn(),
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
    deleteService: vi.fn((id: string) => {
      byId.delete(id);
    }),
  } as unknown as Database;
}

describe('ServiceManager extended DB/user operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggests standard env vars for canonical managed service kinds', async () => {
    const postgres = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      kind: 'postgres',
      credentials: JSON.stringify({
        user: 'openlander',
        password: 'rootpw',
        database: 'openlander',
        host: 'ol-svc-shared-pg',
        port: 5432,
        connectionString: 'postgresql://openlander:rootpw@ol-svc-shared-pg:5432/openlander',
      }),
    });
    const redis = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      kind: 'redis',
      credentials: JSON.stringify({
        host: 'ol-svc-shared-redis',
        port: 6379,
        connectionString: 'redis://ol-svc-shared-redis:6379',
      }),
    });

    const manager = new ServiceManager(
      createMockDockerHarness().docker,
      createDbMock([postgres, redis]),
    );

    await expect(manager.getSuggestedEnv(postgres, { targetProjectId: 'proj-1' })).resolves.toEqual(
      [
        {
          key: 'DATABASE_URL',
          value: 'postgresql://openlander:rootpw@ol-svc-shared-pg:5432/openlander',
        },
      ],
    );
    await expect(manager.getSuggestedEnv(redis, { targetProjectId: 'proj-1' })).resolves.toEqual([
      { key: 'REDIS_URL', value: 'redis://ol-svc-shared-redis:6379' },
    ]);
  });

  it('suggests bare env keys for project-scoped services when target project has no collision', async () => {
    const existingGlobalPg = createService({
      id: 'svc-existing-pg',
      name: 'existing-pg',
      kind: 'postgres',
      credentials: JSON.stringify({
        connectionString: 'postgresql://openlander:pw@ol-svc-existing-pg:5432/app',
      }),
    });
    const projectPg = createService({
      id: 'svc-project-pg',
      name: 'app-pg',
      kind: 'postgres',
      credentials: JSON.stringify({
        connectionString: 'postgresql://openlander:pw@ol-svc-app-pg:5432/app',
      }),
    });

    const manager = new ServiceManager(
      createMockDockerHarness().docker,
      createDbMock([existingGlobalPg, projectPg]),
    );

    await expect(
      manager.getSuggestedEnv(projectPg, { targetProjectId: 'proj-1' }),
    ).resolves.toEqual([
      { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-app-pg:5432/app' },
    ]);
  });

  it('prefixes project-scoped env keys when the target project already has the bare key', async () => {
    const projectPg = createService({
      id: 'svc-project-pg',
      name: 'analytics-pg',
      kind: 'postgres',
      credentials: JSON.stringify({
        connectionString: 'postgresql://openlander:pw@ol-svc-analytics-pg:5432/app',
      }),
    });

    const manager = new ServiceManager(
      createMockDockerHarness().docker,
      createDbMock([projectPg], [], {
        projectEnv: { 'proj-1': { DATABASE_URL: 'postgresql://existing' } },
      }),
    );

    await expect(
      manager.getSuggestedEnv(projectPg, { targetProjectId: 'proj-1' }),
    ).resolves.toEqual([
      {
        key: 'ANALYTICS_PG_DATABASE_URL',
        value: 'postgresql://openlander:pw@ol-svc-analytics-pg:5432/app',
      },
    ]);
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
      'Database listing is not supported for service type: redis',
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
      'User listing is not supported for service type: redis',
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
      'Database creation is not supported for service type: redis',
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
      'User creation is not supported for service type: redis',
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
    // postgres adapter getConnectionStats issues 2 psql execs (active count + max_connections)
    dockerHarness.queueExecResult('svc-stats-container', { exitCode: 0, stdout: '0\n' });
    dockerHarness.queueExecResult('svc-stats-container', { exitCode: 0, stdout: '' });
    const manager = new ServiceManager(dockerHarness.docker, db);

    const stats = await manager.getStats('svc-stats');

    expect(stats).toEqual({
      status: 'running',
      diskUsageBytes: 4096,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      activeConnections: 0,
      maxConnections: null,
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
      activeConnections: null,
      maxConnections: null,
    });
    expect(dockerHarness.getExecCommands('svc-stopped-container')).toEqual([]);
  });

  it('recordLightweightMetricSample() writes CPU and memory without service exec probes', async () => {
    const service = createService({
      id: 'svc-metric',
      status: 'running',
      container_id: 'svc-metric-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.docker.getContainerStats = vi.fn().mockResolvedValue({
      cpu_stats: {
        cpu_usage: { total_usage: 1500, percpu_usage: [0, 0] },
        system_cpu_usage: 2000,
      },
      precpu_stats: { cpu_usage: { total_usage: 500 }, system_cpu_usage: 1000 },
      memory_stats: { usage: 64 * 1024 * 1024, limit: 256 * 1024 * 1024 },
    });
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.recordLightweightMetricSample('svc-metric');

    expect(dockerHarness.docker.getContainerStats).toHaveBeenCalledWith('svc-metric-container');
    expect(db.recordServiceMetricSample).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'svc-metric',
        cpu: 200,
        mem: 64,
        req: 0,
        err: 0,
        p95LatencyMs: null,
        requestCount: 0,
      }),
    );
    expect(dockerHarness.getExecCommands('svc-metric-container')).toEqual([]);
  });

  it('recordLightweightMetricSample() skips DB writes when Docker stats are unavailable', async () => {
    const service = createService({
      id: 'svc-metric',
      status: 'running',
      container_id: 'svc-metric-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.docker.getContainerStats = vi.fn().mockRejectedValue(new Error('daemon busy'));
    const manager = new ServiceManager(dockerHarness.docker, db);

    await manager.recordLightweightMetricSample('svc-metric');

    expect(db.recordServiceMetricSample).not.toHaveBeenCalled();
  });
});

describe('ServiceManager reconciliation behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('list() logs warn and marks service error when inspect fails', async () => {
    const service = createService({
      id: 'svc-failed-inspect',
      status: 'running',
      container_id: 'svc-failed-inspect-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    (dockerHarness.docker.inspectContainer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('inspect failed'),
    );

    const manager = new ServiceManager(dockerHarness.docker, db);
    const list = await manager.list();

    expect(db.updateService).toHaveBeenCalledWith('svc-failed-inspect', {
      status: 'error',
      containerId: 'svc-failed-inspect-container',
    });
    expect(list[0]?.status).toBe('error');
  });

  it('list() marks non-provisioning service without container reference as error', async () => {
    const service = createService({
      id: 'svc-missing-container-ref',
      status: 'stopped',
    });
    service.container_id = null;
    service.container_name = '';
    const db = createDbMock([service]);
    const manager = new ServiceManager(createMockDockerHarness().docker, db);

    const list = await manager.list();

    expect(db.updateService).toHaveBeenCalledWith('svc-missing-container-ref', {
      status: 'error',
      containerId: null,
    });
    expect(list[0]?.status).toBe('error');
  });

  it('list() sets service status to running when inspect succeeds', async () => {
    const service = createService({
      id: 'svc-reconcile-running',
      status: 'stopped',
      container_id: 'svc-reconcile-running-container',
    });
    const db = createDbMock([service]);
    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-reconcile-running-container', true);

    const manager = new ServiceManager(dockerHarness.docker, db);
    const list = await manager.list();

    expect(db.updateService).toHaveBeenCalledWith('svc-reconcile-running', {
      status: 'running',
      containerId: 'svc-reconcile-running-container',
    });
    expect(list[0]?.status).toBe('running');
  });

  it('list() marks all services error when Docker daemon is unavailable', async () => {
    const services = [
      createService({
        id: 'svc-daemon-1',
        status: 'running',
        container_id: 'svc-daemon-1-container',
      }),
      createService({
        id: 'svc-daemon-2',
        status: 'stopped',
        container_id: 'svc-daemon-2-container',
      }),
    ];
    const db = createDbMock(services);
    const dockerHarness = createMockDockerHarness();
    (dockerHarness.docker.inspectContainer as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Docker daemon unavailable'),
    );

    const manager = new ServiceManager(dockerHarness.docker, db);
    const list = await manager.list();

    expect(db.updateService).toHaveBeenCalledWith('svc-daemon-1', {
      status: 'error',
      containerId: 'svc-daemon-1-container',
    });
    expect(db.updateService).toHaveBeenCalledWith('svc-daemon-2', {
      status: 'error',
      containerId: 'svc-daemon-2-container',
    });
    expect(list.map((service) => service.status)).toEqual(['error', 'error']);
  });
});

describe('ServiceManager remove with connected projects warning', () => {
  it('remove() returns warning when service has connected projects', async () => {
    const service = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      container_name: 'ol-svc-shared-pg',
    });
    const projects = [
      { id: 'proj-1', name: 'my-app' },
      { id: 'proj-2', name: 'api-server' },
    ];
    const db = createDbMock([service], projects);
    vi.mocked(db.getEnvVars).mockImplementation((projectId: string) => {
      if (projectId === 'proj-1') {
        return { DATABASE_URL: 'postgresql://ol-svc-shared-pg:5432/db' } as Record<string, string>;
      }
      if (projectId === 'proj-2') {
        return { DB_HOST: 'ol-svc-shared-pg' } as Record<string, string>;
      }
      return {} as Record<string, string>;
    });

    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, db);

    await expect(manager.remove('svc-pg')).rejects.toThrow(
      'Service "shared-pg" is referenced by 2 project(s): my-app, api-server.',
    );
    expect(db.deleteService).not.toHaveBeenCalled();
  });

  it('detects connected projects through service-scoped env vars', async () => {
    const database = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      container_name: 'ol-svc-shared-pg',
    });
    const deployable = createService({
      id: 'web-svc',
      name: 'web',
      kind: 'git',
      container_name: 'ol-web',
    });
    const projects = [{ id: 'proj-1', name: 'my-app' }];
    const db = createDbMock([database, deployable], projects);
    vi.mocked(db.getDeployablesByGroup).mockImplementation((projectId: string) =>
      projectId === 'proj-1' ? [deployable] : [],
    );
    vi.mocked(db.getEnvVarsForService).mockImplementation((projectId: string, serviceId: string) =>
      projectId === 'proj-1' && serviceId === 'web-svc'
        ? ({ DATABASE_URL: 'postgresql://ol-svc-shared-pg:5432/db' } as Record<string, string>)
        : {},
    );

    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, db);

    await expect(manager.remove('svc-pg')).rejects.toThrow(
      'Service "shared-pg" is referenced by 1 project(s): my-app.',
    );
    expect(db.deleteService).not.toHaveBeenCalled();
  });

  it('remove() returns no warning when service has no connected projects', async () => {
    const service = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      container_name: 'ol-svc-shared-redis',
    });
    const db = createDbMock([service], []);
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, db);

    const result = await manager.remove('svc-redis');

    expect(result.warning).toBeUndefined();
    expect(result.connected_projects).toBeUndefined();
    expect(db.deleteService).toHaveBeenCalledWith('svc-redis');
  });
});

// ---------------------------------------------------------------------------
// Day 8 Bug #6: ServiceManager raw `throw new Error(...)` replacement.
// All public methods that previously threw raw Errors should now throw
// typed OpenLanderError subclasses so HTTP / MCP error handlers can
// pattern-match on the class.
// ---------------------------------------------------------------------------
describe('ServiceManager typed error contract (Day 8 Bug #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('start() throws ServiceNotFoundError when id is missing', async () => {
    const { ServiceNotFoundError } = await import('../src/errors.js');
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(manager.start('missing-svc')).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it('stop() throws ServiceNotFoundError when id is missing', async () => {
    const { ServiceNotFoundError } = await import('../src/errors.js');
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(manager.stop('missing-svc')).rejects.toBeInstanceOf(ServiceNotFoundError);
  });

  it('remove() throws ServiceInUseError when projects reference the service (no force)', async () => {
    const { ServiceInUseError } = await import('../src/errors.js');
    const service = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      container_name: 'ol-svc-shared-pg',
    });
    const db = createDbMock([service], [{ id: 'proj-1', name: 'my-app' }]);
    db.getEnvVars = vi.fn(() => ({ DATABASE_URL: 'postgresql://ol-svc-shared-pg:5432/db' }));

    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, db);

    await expect(manager.remove('svc-pg')).rejects.toBeInstanceOf(ServiceInUseError);
  });

  it('create() throws ServiceConfigError when neither template nor image provided', async () => {
    const { ServiceConfigError } = await import('../src/errors.js');
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(manager.create({ name: 'foo' })).rejects.toBeInstanceOf(ServiceConfigError);
  });

  it('create() throws ServiceConfigError for unsupported template', async () => {
    const { ServiceConfigError } = await import('../src/errors.js');
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([]));

    await expect(
      manager.create({ name: 'foo', template: 'nonexistent-db' }),
    ).rejects.toBeInstanceOf(ServiceConfigError);
  });

  it('listDatabases() throws ServiceContainerStateError when container is stopped', async () => {
    const { ServiceContainerStateError } = await import('../src/errors.js');
    const postgres = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      container_id: 'svc-pg-container',
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', false);
    const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));

    await expect(manager.listDatabases('svc-pg')).rejects.toBeInstanceOf(
      ServiceContainerStateError,
    );
  });
});
