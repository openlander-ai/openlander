import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database, ServiceRow } from '../../src/db/index.js';
import {
  ManagedServiceNameConflictError,
  ManagedServicePersistenceCleanedError,
} from '../../src/errors.js';
import { clearPortReservations, clearPortScanCache } from '../../src/pipeline/port.js';
import { ServiceManager } from '../../src/pipeline/service-manager.js';
import { createMockDockerHarness } from '../helpers/docker-mocks.js';

function createServiceRow(partial: Partial<ServiceRow>): ServiceRow {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: partial.id ?? 'svc-1',
    project_id: partial.project_id ?? '__orphan_managed',
    name: partial.name ?? 'managed-service',
    kind: partial.kind ?? 'redis',
    parent_service_id: null,
    status: partial.status ?? 'stopped',
    visibility: null,
    assigned_port: partial.assigned_port ?? null,
    container_id: partial.container_id ?? null,
    container_name: partial.container_name ?? null,
    container_port: partial.container_port ?? null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: partial.source ?? 'image',
    repo_url: null,
    branch: null,
    image_url: partial.image_url ?? null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: partial.credentials ?? null,
    created_at: now,
    updated_at: now,
    archived_at: null,
    server_id: 'local',
    type: partial.type,
    image: partial.image,
    port: partial.port,
  };
}

function kindFromType(type: string): ServiceRow['kind'] {
  switch (type) {
    case 'postgresql':
      return 'postgres';
    case 'mongodb':
      return 'mongo';
    case 'mysql':
    case 'redis':
    case 'minio':
      return type;
    default:
      return 'image';
  }
}

function createDbMock(): Database {
  const byId = new Map<string, ServiceRow>();
  return {
    getUsedPorts: vi.fn(() =>
      Array.from(byId.values()).flatMap((service) => {
        const port = service.assigned_port ?? service.port ?? null;
        return port === null ? [] : [port];
      }),
    ),
    listServices: vi.fn(() => Array.from(byId.values())),
    createService: vi.fn(
      (service: {
        id: string;
        name: string;
        type: string;
        image: string;
        containerName: string;
        port: number;
        credentials?: string;
      }) => {
        const row = createServiceRow({
          id: service.id,
          name: service.name,
          kind: kindFromType(service.type),
          source: 'image',
          image_url: service.image,
          assigned_port: service.port,
          container_name: service.containerName,
          credentials: service.credentials ?? null,
          type: service.type,
          image: service.image,
          port: service.port,
        });
        byId.set(row.id, row);
        return row;
      },
    ),
    updateService: vi.fn(
      (id: string, updates: { status?: ServiceRow['status']; containerId?: string | null }) => {
        const current = byId.get(id);
        if (!current) return;
        byId.set(id, {
          ...current,
          status: updates.status ?? current.status,
          container_id: updates.containerId ?? current.container_id,
        });
      },
    ),
    getService: vi.fn((id: string) => byId.get(id)),
    deleteService: vi.fn((id: string) => {
      byId.delete(id);
    }),
  } as unknown as Database;
}

describe('ServiceManager.create regressions', () => {
  beforeEach(() => {
    clearPortScanCache();
    clearPortReservations();
  });

  it('clears port scan cache before releasing reservation between consecutive creates', async () => {
    const db = createDbMock();
    const dockerHarness = createMockDockerHarness();
    const manager = new ServiceManager(dockerHarness.docker, db);

    const first = await manager.create({ name: 'first-redis', template: 'redis' });
    const second = await manager.create({ name: 'second-redis', template: 'redis' });

    expect(first.assigned_port).toEqual(expect.any(Number));
    expect(second.assigned_port).toEqual(expect.any(Number));
    expect(second.assigned_port).not.toBe(first.assigned_port);
  });

  it('rolls back container and volume when service persistence fails', async () => {
    const db = createDbMock();
    const dockerHarness = createMockDockerHarness();
    const persistError = new Error('db insert failed');
    (db.createService as ReturnType<typeof vi.fn>).mockRejectedValueOnce(persistError);
    const manager = new ServiceManager(dockerHarness.docker, db);

    await expect(
      manager.create({
        name: 'broken-pg',
        template: 'postgresql',
      }),
    ).rejects.toBeInstanceOf(ManagedServicePersistenceCleanedError);

    expect(dockerHarness.docker.safeRemoveContainer).toHaveBeenCalledWith('ol-svc-broken-pg-id');
    expect(dockerHarness.docker.removeVolume).toHaveBeenCalledWith('ol-svc-data-broken-pg');
    expect(db.deleteService).toHaveBeenCalled();
  });

  it('wraps Docker name conflicts in a sanitized managed-service error', async () => {
    const db = createDbMock();
    const dockerHarness = createMockDockerHarness();
    const conflict = new Error(
      '(HTTP code 409) unexpected - Conflict. The container name "/ol-svc-conflict-redis" is already in use by container "abcdef1234567890". You have to remove (or rename) that container to be able to reuse that name.',
    );
    (conflict as { statusCode?: number }).statusCode = 409;
    (dockerHarness.docker.runServiceContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      conflict,
    );
    const manager = new ServiceManager(dockerHarness.docker, db);

    let caught: unknown;
    try {
      await manager.create({
        name: 'conflict-redis',
        template: 'redis',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ManagedServiceNameConflictError);
    expect(caught).toMatchObject({
      code: 'MANAGED_SERVICE_NAME_CONFLICT',
      details: {
        containerName: 'ol-svc-conflict-redis',
        volumeRolledBack: true,
      },
    });
    expect(caught instanceof Error ? caught.message : String(caught)).not.toContain(
      'abcdef1234567890',
    );
    expect(dockerHarness.docker.removeVolume).toHaveBeenCalledWith('ol-svc-data-conflict-redis');
  });
});
