/**
 * Phase 4 validation — Blocker 3 fix
 *
 * Asserts the /api/projects/:id/topology endpoint health projection:
 *   - Docker `starting` (start_period grace window) → UI `healthy`
 *   - Docker `unhealthy`                            → UI `crashed`
 *   - Docker `healthy`                              → UI `healthy`
 *   - Docker `null` (no HEALTHCHECK)                → UI `healthy`
 *   - inspect throws                                → UI `crashed`
 *
 * The pre-fix behaviour collapsed both `starting` AND `unhealthy` to
 * `crashed`, which falsely flagged every fresh deploy as crashed in
 * InfraMap during the healthcheck start_period.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../src/app.js';
import { createProjectRoutes } from '../src/web/api/project-routes.js';

interface ServiceNode {
  id: string;
  name: string;
  health: 'healthy' | 'crashed';
  cpu: string;
  mem: string;
}

interface TopologyResponse {
  services: ServiceNode[];
}

function createCtx(opts: {
  inspectResult: { healthStatus: string | null } | 'throw';
  status?: 'running' | 'stopped';
}) {
  const project = {
    id: 'p1',
    name: 'demo',
    container_id: 'c1',
    status: opts.status ?? 'running',
    image_tag: 'demo:latest',
    image_url: null,
    assigned_port: 3000,
  };

  const inspectContainer = vi.fn(() => {
    if (opts.inspectResult === 'throw') {
      return Promise.reject(new Error('docker daemon unavailable'));
    }
    return Promise.resolve({
      State: {
        Health:
          opts.inspectResult.healthStatus === null
            ? undefined
            : { Status: opts.inspectResult.healthStatus },
      },
    });
  });

  const ctx = {
    db: {
      getProject: vi.fn((id: string) => (id === 'p1' ? project : null)),
      getProjectByName: vi.fn(() => null),
      getChildProjects: vi.fn(() => []),
      findDependenciesByProject: vi.fn(() => []),
    },
    docker: {
      inspectContainer,
      getContainerStats: vi.fn().mockResolvedValue({
        cpu_stats: {
          cpu_usage: { total_usage: 0, percpu_usage: [0] },
          system_cpu_usage: 0,
          online_cpus: 1,
        },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        memory_stats: { usage: 0, limit: 0 },
      }),
    },
  } as unknown as AppContext;

  return ctx;
}

async function fetchTopologyHealth(ctx: AppContext): Promise<'healthy' | 'crashed'> {
  const app = new Hono();
  app.route('/api', createProjectRoutes(ctx));
  const res = await app.request('/api/projects/p1/topology');
  expect(res.status).toBe(200);
  const body = (await res.json()) as TopologyResponse;
  expect(body.services).toHaveLength(1);
  return body.services[0]!.health;
}

describe("project topology — health projection (Blocker 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("docker 'starting' (HEALTHCHECK start_period) → UI 'healthy'", async () => {
    const ctx = createCtx({ inspectResult: { healthStatus: 'starting' } });
    expect(await fetchTopologyHealth(ctx)).toBe('healthy');
  });

  it("docker 'unhealthy' → UI 'crashed'", async () => {
    const ctx = createCtx({ inspectResult: { healthStatus: 'unhealthy' } });
    expect(await fetchTopologyHealth(ctx)).toBe('crashed');
  });

  it("docker 'healthy' → UI 'healthy'", async () => {
    const ctx = createCtx({ inspectResult: { healthStatus: 'healthy' } });
    expect(await fetchTopologyHealth(ctx)).toBe('healthy');
  });

  it("no HEALTHCHECK declared (Docker reports null) → UI 'healthy'", async () => {
    const ctx = createCtx({ inspectResult: { healthStatus: null } });
    expect(await fetchTopologyHealth(ctx)).toBe('healthy');
  });

  it("inspect throws → UI 'crashed' (parity with ServiceManager error path)", async () => {
    const ctx = createCtx({ inspectResult: 'throw' });
    expect(await fetchTopologyHealth(ctx)).toBe('crashed');
  });

  it("project status !== 'running' → UI 'crashed' (independent of inspect)", async () => {
    const ctx = createCtx({
      inspectResult: { healthStatus: 'healthy' },
      status: 'stopped',
    });
    expect(await fetchTopologyHealth(ctx)).toBe('crashed');
  });
});
