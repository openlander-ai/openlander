/**
 * Phase 4 validation — Blocker 1 fix
 *
 * Asserts that ServiceHealthMonitor.runServiceCheck invokes
 * ServiceManager.recordMetricSample on the success branch (container
 * still running) and that a recorder failure is swallowed so the
 * health-check loop keeps ticking.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceHealthMonitor } from '../src/monitor/service-health-monitor.js';
import type { Database, ServiceRow } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { EventBus } from '../src/events/index.js';
import type { ServiceManager } from '../src/pipeline/service-manager.js';

function createService(partial: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: partial.id ?? 'svc-1',
    project_id: partial.project_id ?? 'proj-1',
    name: partial.name ?? 'shared-pg',
    type: partial.type ?? 'postgresql',
    image: partial.image ?? 'postgres:16-alpine',
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'svc-1-container',
    container_name: partial.container_name ?? 'ol-svc-shared-pg',
    kind: partial.kind ?? 'postgres',
    runtime_role: partial.runtime_role ?? 'resource',
    port: partial.port ?? 5432,
    env_vars: partial.env_vars ?? null,
    credentials: partial.credentials ?? null,
    archived_at: partial.archived_at ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  } as ServiceRow;
}

function createMockDb(services: ServiceRow[]): Database {
  return {
    listServices: vi.fn(() => services),
    listServiceConnectionsByService: vi.fn(() => []),
    updateService: vi.fn(),
    createRuntimeIncident: vi.fn(),
  } as unknown as Database;
}

function createMockDocker(
  running: boolean,
  opts: { restarting?: boolean; exitCode?: number } = {},
): Docker {
  return {
    inspectContainer: vi.fn().mockResolvedValue({
      State: {
        Running: running,
        Restarting: opts.restarting ?? false,
        ExitCode: opts.exitCode ?? 0,
        Health: { Status: 'healthy' },
      },
    }),
  } as unknown as Docker;
}

function createMockEvents(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
  } as unknown as EventBus;
}

describe('ServiceHealthMonitor — recordMetricSample wiring (Blocker 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes serviceManager.recordMetricSample after a healthy check', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });
    await monitor.checkAllServices();

    expect(recordMetricSample).toHaveBeenCalledTimes(1);
    expect(recordMetricSample).toHaveBeenCalledWith('svc-1');
  });

  it('invokes lightweight metric recorder after a healthy check', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const recordLightweightMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = {
      recordMetricSample,
      recordLightweightMetricSample,
    } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });
    await monitor.checkAllServices();

    expect(recordLightweightMetricSample).toHaveBeenCalledTimes(1);
    expect(recordLightweightMetricSample).toHaveBeenCalledWith('svc-1');
    expect(recordMetricSample).toHaveBeenCalledTimes(1);
  });

  it('does not crash the health loop when lightweight metric recorder throws', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const recordLightweightMetricSample = vi.fn().mockRejectedValue(new Error('stats failed'));
    const serviceManager = {
      recordMetricSample,
      recordLightweightMetricSample,
    } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });

    await expect(monitor.checkAllServices()).resolves.toBeUndefined();
    expect(recordLightweightMetricSample).toHaveBeenCalledTimes(1);
    expect(recordMetricSample).toHaveBeenCalledTimes(1);
  });

  it('samples long-running compose children and managed services but skips parents, jobs, and archived rows', async () => {
    const composeParent = createService({
      id: 'compose-parent',
      kind: 'compose',
      container_id: 'compose-parent-container',
    });
    const composeChild = createService({
      id: 'compose-child',
      kind: 'compose-child',
      container_id: 'compose-child-container',
    });
    const composeJob = createService({
      id: 'compose-job',
      kind: 'compose-child',
      runtime_role: 'job',
      status: 'stopped',
      container_id: 'compose-job-container',
    });
    const redis = createService({
      id: 'redis',
      kind: 'redis',
      container_id: 'redis-container',
    });
    const archived = createService({
      id: 'archived',
      kind: 'image',
      container_id: 'archived-container',
      archived_at: '2026-01-02T00:00:00.000Z',
    });
    const db = createMockDb([composeParent, composeChild, composeJob, redis, archived]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const recordLightweightMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = {
      recordMetricSample,
      recordLightweightMetricSample,
    } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });
    await monitor.checkAllServices();

    expect(recordLightweightMetricSample).toHaveBeenCalledTimes(2);
    expect(recordLightweightMetricSample).toHaveBeenCalledWith('compose-child');
    expect(recordLightweightMetricSample).toHaveBeenCalledWith('redis');
    expect(recordLightweightMetricSample).not.toHaveBeenCalledWith('compose-parent');
    expect(recordLightweightMetricSample).not.toHaveBeenCalledWith('compose-job');
    expect(recordLightweightMetricSample).not.toHaveBeenCalledWith('archived');
    expect(docker.inspectContainer).not.toHaveBeenCalledWith('compose-job-container');
    expect(db.createRuntimeIncident).not.toHaveBeenCalled();
  });

  it('treats an exited-zero one-shot job as healthy when checked directly', async () => {
    const service = createService({
      id: 'compose-job',
      kind: 'compose-child',
      runtime_role: 'job',
      status: 'stopped',
    });
    const db = createMockDb([service]);
    const docker = createMockDocker(false, { exitCode: 0 });
    const monitor = new ServiceHealthMonitor(docker, db, createMockEvents());

    await expect(monitor.checkService(service)).resolves.toEqual({ healthy: true });
  });

  it('reports a non-zero one-shot job exit without creating a passive service-down incident', async () => {
    const service = createService({
      id: 'compose-job',
      kind: 'compose-child',
      runtime_role: 'job',
      status: 'stopped',
    });
    const db = createMockDb([service]);
    const docker = createMockDocker(false, { exitCode: 17 });
    const monitor = new ServiceHealthMonitor(docker, db, createMockEvents());

    await expect(monitor.checkService(service)).resolves.toEqual({
      healthy: false,
      error: 'One-shot job exited with code 17',
    });
    await monitor.checkAllServices();

    expect(db.createRuntimeIncident).not.toHaveBeenCalled();
  });

  it('does not crash the health loop when recordMetricSample throws', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockRejectedValue(new Error('db write failed'));
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });

    // Must not throw — recorder failure is logged and swallowed.
    await expect(monitor.checkAllServices()).resolves.toBeUndefined();
    expect(recordMetricSample).toHaveBeenCalledTimes(1);
  });

  it('does not invoke recordMetricSample when container is not running', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(false);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });
    await monitor.checkAllServices();

    expect(recordMetricSample).not.toHaveBeenCalled();
  });

  it('marks a restarting container as error and skips metric recording', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true, { restarting: true, exitCode: 1 });
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });
    await monitor.checkAllServices();

    expect(db.updateService).toHaveBeenCalledOnce();
    expect(db.updateService).toHaveBeenCalledWith('svc-1', { status: 'error' });
    expect(db.createRuntimeIncident).toHaveBeenCalledOnce();
    expect(db.createRuntimeIncident).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', serviceId: 'svc-1' }),
    );
    expect(recordMetricSample).not.toHaveBeenCalled();
  });

  it('reports a restarting container as unhealthy from checkService', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true, { restarting: true, exitCode: 1 });
    const events = createMockEvents();

    const monitor = new ServiceHealthMonitor(docker, db, events);
    const result = await monitor.checkService(service);

    expect(result).toEqual({
      healthy: false,
      error: 'Container is restarting (exit code: 1)',
    });
  });

  it('runs without a serviceManager option (back-compat)', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const monitor = new ServiceHealthMonitor(docker, db, events);
    await expect(monitor.checkAllServices()).resolves.toBeUndefined();
  });
});
