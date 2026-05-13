import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => mockLogger),
}));

vi.mock('../src/lib/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 12345 })),
  };
});

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

function createDbMock(services: ServiceRow[]): Database {
  const byId = new Map(services.map((svc) => [svc.id, svc]));
  return {
    getService: vi.fn((id: string) => byId.get(id) ?? null),
    listServices: vi.fn(() => Array.from(byId.values())),
    updateService: vi.fn(),
    deleteService: vi.fn(),
  } as unknown as Database;
}

function setupBackupContainerMock(harness: ReturnType<typeof createMockDockerHarness>): void {
  harness.client.createContainer.mockResolvedValue({
    id: 'backup-container-id',
    start: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
  });
}

describe('ServiceManager backup Redis BGSAVE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls BGSAVE and polls LASTSAVE before volume backup for Redis services', async () => {
    const redis = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      container_id: 'svc-redis-container',
      container_name: 'ol-svc-shared-redis',
      port: 6379,
      credentials: null,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-redis-container', true);

    // BGSAVE flow: initial LASTSAVE → BGSAVE → poll LASTSAVE (changed)
    dockerHarness.queueExecResult('svc-redis-container', {
      exitCode: 0,
      stdout: '1000',
    });
    dockerHarness.queueExecResult('svc-redis-container', {
      exitCode: 0,
      stdout: 'Background saving started',
    });
    dockerHarness.queueExecResult('svc-redis-container', {
      exitCode: 0,
      stdout: '1001',
    });

    setupBackupContainerMock(dockerHarness);

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));
    const result = await manager.backup('svc-redis');

    const commands = dockerHarness.getExecCommands('svc-redis-container');
    expect(commands).toHaveLength(3);
    expect(commands[0]).toEqual(['redis-cli', 'LASTSAVE']);
    expect(commands[1]).toEqual(['redis-cli', 'BGSAVE']);
    expect(commands[2]).toEqual(['redis-cli', 'LASTSAVE']);

    expect(result.size).toBe(12345);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Redis BGSAVE completed'));
  });

  it('does NOT call BGSAVE for PostgreSQL services', async () => {
    const postgres = createService({
      id: 'svc-pg',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      container_id: 'svc-pg-container',
      container_name: 'ol-svc-shared-pg',
      port: 5432,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-pg-container', true);
    setupBackupContainerMock(dockerHarness);

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([postgres]));
    await manager.backup('svc-pg');

    const commands = dockerHarness.getExecCommands('svc-pg-container');
    expect(commands).toHaveLength(0);
  });

  it('continues backup when BGSAVE fails', async () => {
    const redis = createService({
      id: 'svc-redis',
      name: 'shared-redis',
      type: 'redis',
      image: 'redis:7-alpine',
      container_id: 'svc-redis-container',
      container_name: 'ol-svc-shared-redis',
      port: 6379,
      credentials: null,
    });

    const dockerHarness = createMockDockerHarness();
    dockerHarness.setContainerRunning('svc-redis-container', true);

    // LASTSAVE succeeds, but BGSAVE fails (exit code 1)
    dockerHarness.queueExecResult('svc-redis-container', {
      exitCode: 0,
      stdout: '1000',
    });
    dockerHarness.queueExecResult('svc-redis-container', {
      exitCode: 1,
      stderr: 'ERR BGSAVE failed',
    });

    setupBackupContainerMock(dockerHarness);

    const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));
    const result = await manager.backup('svc-redis');

    expect(result.size).toBe(12345);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Redis BGSAVE failed'));
  });

  it('writes backups through the OpenLander data volume when running in a container', async () => {
    const originalContainerized = process.env.OPENLANDER_CONTAINERIZED;
    const originalDataVolume = process.env.OPENLANDER_DATA_VOLUME;
    process.env.OPENLANDER_CONTAINERIZED = 'true';
    process.env.OPENLANDER_DATA_VOLUME = 'openlander-test-data';

    try {
      const redis = createService({
        id: 'svc-redis',
        name: 'shared-redis',
        type: 'redis',
        image: 'redis:7-alpine',
        container_id: 'svc-redis-container',
        container_name: 'ol-svc-shared-redis',
        port: 6379,
        credentials: null,
      });

      const dockerHarness = createMockDockerHarness();
      dockerHarness.setContainerRunning('svc-redis-container', true);
      dockerHarness.queueExecResult('svc-redis-container', { exitCode: 0, stdout: '1000' });
      dockerHarness.queueExecResult('svc-redis-container', {
        exitCode: 0,
        stdout: 'Background saving started',
      });
      dockerHarness.queueExecResult('svc-redis-container', { exitCode: 0, stdout: '1001' });

      const manager = new ServiceManager(dockerHarness.docker, createDbMock([redis]));
      await manager.backup('svc-redis');

      const backupContainer = dockerHarness.createdContainers[0];
      expect(backupContainer).toMatchObject({
        Image: 'alpine',
        HostConfig: {
          Binds: expect.arrayContaining([
            'ol-svc-data-shared-redis:/data:ro',
            'openlander-test-data:/openlander-data',
          ]),
        },
      });
      expect(backupContainer?.['Cmd']).toEqual([
        'tar',
        'czf',
        expect.stringMatching(/^\/openlander-data\/backups\/shared-redis-\d+\.tar\.gz$/),
        '-C',
        '/data',
        '.',
      ]);
    } finally {
      if (originalContainerized === undefined) {
        delete process.env.OPENLANDER_CONTAINERIZED;
      } else {
        process.env.OPENLANDER_CONTAINERIZED = originalContainerized;
      }
      if (originalDataVolume === undefined) {
        delete process.env.OPENLANDER_DATA_VOLUME;
      } else {
        process.env.OPENLANDER_DATA_VOLUME = originalDataVolume;
      }
    }
  });
});
