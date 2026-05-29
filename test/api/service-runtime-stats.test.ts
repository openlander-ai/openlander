import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { loadProjectRuntimeStats } from '../../src/web/api/helpers/service-runtime-stats.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'p-1',
    name: 'p-1',
    display_name: 'P 1',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p-1__svc',
    project_id: 'p-1',
    name: 'p-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 9100,
    container_id: 'container-1',
    container_name: 'ol-p1',
    container_port: 3000,
    image_tag: 'p-1:tag',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
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
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

const runningStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 300, percpu_usage: [0, 0] },
    system_cpu_usage: 1000,
    online_cpus: 2,
  },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
  memory_stats: { usage: 64 * 1024 * 1024, limit: 256 * 1024 * 1024 },
};

function makeCtx(overrides: {
  deployable?: ServiceRow | undefined;
  getContainerStats?: ReturnType<typeof vi.fn>;
}): Pick<AppContext, 'db' | 'docker'> {
  const getDeployableForProject = vi.fn(async () => overrides.deployable);
  return {
    db: { getDeployableForProject } as unknown as AppContext['db'],
    docker: {
      getContainerStats: overrides.getContainerStats ?? vi.fn(async () => runningStats),
    } as unknown as AppContext['docker'],
  };
}

describe('loadProjectRuntimeStats', () => {
  it('returns the rounded cpu + raw memory + status for a running container', async () => {
    const ctx = makeCtx({ deployable: makeServiceRow() });
    const stats = await loadProjectRuntimeStats(ctx, makeProjectRow());

    expect(stats).toEqual({
      cpu: 80,
      memory: 67108864,
      memoryLimit: 268435456,
      status: 'running',
    });
    expect(ctx.docker.getContainerStats).toHaveBeenCalledWith('container-1');
  });

  it('zeroes stats but keeps status when container is not running', async () => {
    const ctx = makeCtx({
      deployable: makeServiceRow({ status: 'stopped', container_id: 'container-1' }),
    });
    const stats = await loadProjectRuntimeStats(ctx, makeProjectRow());

    expect(stats).toEqual({ cpu: 0, memory: 0, memoryLimit: 0, status: 'stopped' });
    expect(ctx.docker.getContainerStats).not.toHaveBeenCalled();
  });

  it('falls back to ProjectRow status / container_id when deployable is missing', async () => {
    const ctx = makeCtx({ deployable: undefined });
    const stats = await loadProjectRuntimeStats(
      ctx,
      makeProjectRow({ status: 'stopped', container_id: 'legacy-container' }),
    );

    expect(stats.status).toBe('stopped');
    expect(ctx.docker.getContainerStats).not.toHaveBeenCalled();
  });

  it('collapses a getContainerStats failure to zeroed stats with the resolved status', async () => {
    const ctx = makeCtx({
      deployable: makeServiceRow(),
      getContainerStats: vi.fn(async () => {
        throw new Error('docker timeout');
      }),
    });
    const stats = await loadProjectRuntimeStats(ctx, makeProjectRow());

    expect(stats).toEqual({ cpu: 0, memory: 0, memoryLimit: 0, status: 'running' });
  });

  it('falls back online_cpus when percpu_usage is missing', async () => {
    const ctx = makeCtx({
      deployable: makeServiceRow(),
      getContainerStats: vi.fn(async () => ({
        cpu_stats: {
          cpu_usage: { total_usage: 300 },
          system_cpu_usage: 1000,
          online_cpus: 4,
        },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
        memory_stats: { usage: 32 * 1024 * 1024, limit: 128 * 1024 * 1024 },
      })),
    });
    const stats = await loadProjectRuntimeStats(ctx, makeProjectRow());

    // (200/500) * 4 * 100 = 160 → rounds to 160
    expect(stats.cpu).toBe(160);
  });

  it('falls back to null status when neither deployable nor project has one', async () => {
    const ctx = makeCtx({ deployable: undefined });
    const stats = await loadProjectRuntimeStats(
      ctx,
      makeProjectRow({ status: null, container_id: null }),
    );

    expect(stats.status).toBeNull();
  });
});
