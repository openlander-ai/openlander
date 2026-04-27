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

function createMockDocker(running: boolean): Docker {
  return {
    inspectContainer: vi.fn().mockResolvedValue({
      State: { Running: running, Health: { Status: 'healthy' } },
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

  it('runs without a serviceManager option (back-compat)', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const monitor = new ServiceHealthMonitor(docker, db, events);
    await expect(monitor.checkAllServices()).resolves.toBeUndefined();
  });
});
