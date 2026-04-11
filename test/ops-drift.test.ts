import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DriftDetector } from '../src/monitor/ops-drift.js';
import type { DriftResult } from '../src/monitor/ops-drift.js';
import type { OpsAlerting } from '../src/monitor/ops-alerting.js';
import type { AppContext } from '../src/app.js';
import type { ServiceRow } from '../src/db/index.js';

function makeService(partial?: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial?.id ?? 'svc-1',
    name: partial?.name ?? 'my-postgres',
    type: partial?.type ?? 'postgresql',
    image: partial?.image ?? 'postgres:16-alpine',
    status: partial?.status ?? 'running',
    container_id: partial?.container_id === undefined ? 'abc123' : partial.container_id,
    container_name: partial?.container_name ?? 'ol-svc-my-postgres',
    port: partial?.port ?? 5432,
    env_vars: partial?.env_vars ?? null,
    credentials: partial?.credentials ?? null,
    created_at: partial?.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial?.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('DriftDetector', () => {
  let listServices: ReturnType<typeof vi.fn>;
  let inspectContainerFn: ReturnType<typeof vi.fn>;
  let sendAlert: ReturnType<typeof vi.fn>;
  let buildContextualAlert: ReturnType<typeof vi.fn>;
  let detector: DriftDetector;

  beforeEach(() => {
    listServices = vi.fn().mockReturnValue([]);
    inspectContainerFn = vi.fn();
    sendAlert = vi.fn().mockResolvedValue(undefined);
    buildContextualAlert = vi.fn().mockImplementation((params) => ({
      severity: params.severity,
      project: { id: params.projectId, name: params.projectName },
      event_type: params.eventType,
      title: params.title,
      description: params.description,
      context: {},
      suggestion: params.suggestion ?? null,
      actions_taken: [],
      incident_id: null,
      timestamp: Date.now(),
    }));

    const ctx = {
      db: { listServices },
      docker: {
        inspectContainer: inspectContainerFn,
      },
    } as unknown as AppContext;

    const alerting = { sendAlert, buildContextualAlert } as unknown as OpsAlerting;
    detector = new DriftDetector(ctx, alerting);
  });

  it('returns empty array when no services exist', async () => {
    listServices.mockReturnValue([]);
    const results = await detector.checkDrift();
    expect(results).toEqual([]);
  });

  it('returns empty array when all services are running normally', async () => {
    listServices.mockReturnValue([makeService()]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'postgres:16-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toEqual([]);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('detects container_stopped when container is not running', async () => {
    listServices.mockReturnValue([makeService()]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: false, Status: 'exited' },
      Config: { Image: 'postgres:16-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      serviceId: 'svc-1',
      serviceName: 'my-postgres',
      driftType: 'container_stopped',
    });
    expect(results[0]?.description).toContain('exited');
    expect(sendAlert).toHaveBeenCalledOnce();
    expect(buildContextualAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        eventType: 'drift_container_stopped',
      }),
    );
  });

  it('detects container_stopped when container inspect fails (not found)', async () => {
    listServices.mockReturnValue([makeService()]);
    inspectContainerFn.mockRejectedValue(new Error('No such container'));

    const results = await detector.checkDrift();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      driftType: 'container_stopped',
      serviceName: 'my-postgres',
    });
    expect(results[0]?.description).toContain('not found');
    expect(sendAlert).toHaveBeenCalledOnce();
  });

  it('detects image_mismatch when running different image', async () => {
    listServices.mockReturnValue([makeService({ image: 'postgres:16-alpine' })]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'postgres:15-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      driftType: 'image_mismatch',
      serviceName: 'my-postgres',
    });
    expect(results[0]?.description).toContain('postgres:15-alpine');
    expect(results[0]?.description).toContain('postgres:16-alpine');
    expect(sendAlert).toHaveBeenCalledOnce();
    expect(buildContextualAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'drift_image_mismatch',
      }),
    );
  });

  it('does not flag image mismatch when images overlap (substring match)', async () => {
    listServices.mockReturnValue([makeService({ image: 'postgres' })]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'postgres:16-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toEqual([]);
  });

  it('falls back to container_name when container_id is null', async () => {
    listServices.mockReturnValue([makeService({ container_id: null })]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'postgres:16-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toEqual([]);
    expect(inspectContainerFn).toHaveBeenCalledWith('ol-svc-my-postgres');
  });

  it('handles multiple services with mixed drift', async () => {
    listServices.mockReturnValue([
      makeService({ id: 'svc-1', name: 'pg', container_id: 'c1', image: 'postgres:16-alpine' }),
      makeService({ id: 'svc-2', name: 'redis', container_id: 'c2', image: 'redis:7-alpine' }),
      makeService({ id: 'svc-3', name: 'mongo', container_id: 'c3', image: 'mongo:7' }),
    ]);

    inspectContainerFn
      .mockResolvedValueOnce({
        State: { Running: true, Status: 'running' },
        Config: { Image: 'postgres:16-alpine' },
      })
      .mockResolvedValueOnce({
        State: { Running: false, Status: 'exited' },
        Config: { Image: 'redis:7-alpine' },
      })
      .mockRejectedValueOnce(new Error('No such container'));

    const results = await detector.checkDrift();
    expect(results).toHaveLength(2);

    const types = results.map((r: DriftResult) => `${r.serviceName}:${r.driftType}`);
    expect(types).toContain('redis:container_stopped');
    expect(types).toContain('mongo:container_stopped');
  });

  it('continues checking other services when one inspect throws', async () => {
    listServices.mockReturnValue([
      makeService({ id: 'svc-1', name: 'pg', container_id: 'c1', image: 'postgres:16-alpine' }),
      makeService({ id: 'svc-2', name: 'redis', container_id: 'c2', image: 'redis:7-alpine' }),
    ]);

    inspectContainerFn.mockRejectedValueOnce(new Error('daemon timeout')).mockResolvedValueOnce({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'redis:7-alpine' },
    });

    const results = await detector.checkDrift();
    expect(results).toHaveLength(1);
    expect(results[0]?.serviceName).toBe('pg');
  });

  it('sends alert with restart suggestion for stopped containers', async () => {
    listServices.mockReturnValue([makeService()]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: false, Status: 'exited' },
      Config: { Image: 'postgres:16-alpine' },
    });

    await detector.checkDrift();
    expect(buildContextualAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.stringContaining('Restart'),
      }),
    );
  });

  it('sends alert with review suggestion for image mismatch', async () => {
    listServices.mockReturnValue([makeService({ image: 'postgres:16-alpine' })]);
    inspectContainerFn.mockResolvedValue({
      State: { Running: true, Status: 'running' },
      Config: { Image: 'postgres:15-alpine' },
    });

    await detector.checkDrift();
    expect(buildContextualAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestion: expect.stringContaining('Review'),
      }),
    );
  });
});
