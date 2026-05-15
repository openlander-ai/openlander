/**
 * Codex MEDIUM-2 fix — recorder rate-limit in health-check loop.
 *
 * The recorder issues `docker exec du -sb`, Docker stats, and adapter
 * connection probes per call. Inline-on-every-tick was heavy enough on
 * busy daemons that a single sweep could stretch past the next tick
 * boundary, tripping the `checking` guard and lowering effective
 * health-check cadence.
 *
 * The fix samples on the first observed-healthy tick and then every
 * Nth tick (default 5). These tests assert the cadence behaviour by
 * driving `checkAllServices()` directly so the test doesn't have to
 * wait on real intervals.
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
    kind: partial.kind ?? 'postgres',
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

describe('ServiceHealthMonitor — recorder rate-limit (Codex MEDIUM-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records on the FIRST observed-healthy tick (warm sparkline immediately)', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: 5,
    });
    await monitor.checkAllServices();

    expect(recordMetricSample).toHaveBeenCalledTimes(1);
  });

  it('skips ticks 2..N-1 then records on the Nth tick', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const N = 5;
    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: N,
    });

    // Tick 1: record (first observed-healthy).
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(1);

    // Ticks 2,3,4: skip.
    await monitor.checkAllServices();
    await monitor.checkAllServices();
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(1);

    // Tick 5: record (periodic).
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(2);

    // Ticks 6..9: skip.
    await monitor.checkAllServices();
    await monitor.checkAllServices();
    await monitor.checkAllServices();
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(2);

    // Tick 10: record (periodic).
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(3);
  });

  it('records lightweight runtime samples on the first tick and every configured runtime tick', async () => {
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

    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: 5,
      recordRuntimeSampleEveryNTicks: 2,
    });

    await monitor.checkAllServices(); // tick 1: first tick
    await monitor.checkAllServices(); // tick 2: runtime periodic
    await monitor.checkAllServices(); // tick 3: skip runtime
    await monitor.checkAllServices(); // tick 4: runtime periodic

    expect(recordLightweightMetricSample).toHaveBeenCalledTimes(3);
    expect(recordMetricSample).toHaveBeenCalledTimes(1);
  });

  it('default cadence is every 5th tick when option not provided', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, { serviceManager });

    // 10 ticks: tick 1 (first) + tick 5 (periodic) + tick 10 (periodic) = 3 samples.
    for (let i = 0; i < 10; i++) {
      await monitor.checkAllServices();
    }
    expect(recordMetricSample).toHaveBeenCalledTimes(3);
  });

  it('recordSampleEveryNTicks=1 records on every tick (legacy behaviour)', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: 1,
    });

    for (let i = 0; i < 4; i++) {
      await monitor.checkAllServices();
    }
    expect(recordMetricSample).toHaveBeenCalledTimes(4);
  });

  it('coerces zero/negative recordSampleEveryNTicks to 1 (no zero-division)', async () => {
    const service = createService({ status: 'running' });
    const db = createMockDb([service]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: 0,
    });

    await monitor.checkAllServices();
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(2);
  });

  it('per-service tick counters are independent across services', async () => {
    const svcA = createService({ id: 'svc-a', name: 'pg-a', container_id: 'cid-a' });
    const svcB = createService({ id: 'svc-b', name: 'pg-b', container_id: 'cid-b' });
    const db = createMockDb([svcA, svcB]);
    const docker = createMockDocker(true);
    const events = createMockEvents();

    const recordMetricSample = vi.fn().mockResolvedValue(undefined);
    const serviceManager = { recordMetricSample } as unknown as ServiceManager;

    const monitor = new ServiceHealthMonitor(docker, db, events, {
      serviceManager,
      recordSampleEveryNTicks: 3,
    });

    // Tick 1: BOTH services record (first-observed-healthy each).
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(2);
    expect(recordMetricSample).toHaveBeenCalledWith('svc-a');
    expect(recordMetricSample).toHaveBeenCalledWith('svc-b');

    // Tick 2: skip A and B (2 % 3 !== 0, not first).
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(2);

    // Tick 3: periodic (3 % 3 === 0) — BOTH record again.
    await monitor.checkAllServices();
    expect(recordMetricSample).toHaveBeenCalledTimes(4);

    // Each service's calls are independent and matched by id.
    expect(recordMetricSample.mock.calls.filter((c) => c[0] === 'svc-a')).toHaveLength(2);
    expect(recordMetricSample.mock.calls.filter((c) => c[0] === 'svc-b')).toHaveLength(2);
  });

  it('does not invoke recorder when container is not running (status filter)', async () => {
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
});
