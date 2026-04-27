/**
 * Phase 4 validation — Blocker 4 fix
 *
 * Asserts that /api/projects/:id/topology funnels per-container stats
 * + inspect through a 15s TTL cache and an in-flight dedupe map, so
 * concurrent and rapid-repeat polls collapse to a single Docker
 * round-trip per service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../src/app.js';
import {
  __test_resetTopologyNodeCache,
  createProjectRoutes,
} from '../src/web/api/project-routes.js';

const STATS_FIXTURE = {
  cpu_stats: {
    cpu_usage: { total_usage: 0, percpu_usage: [0] },
    system_cpu_usage: 0,
    online_cpus: 1,
  },
  precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
  memory_stats: { usage: 0, limit: 0 },
};

function buildCtx(serviceCount: number) {
  // Build N child projects (compose model) under one parent.
  const children = Array.from({ length: serviceCount }, (_, i) => ({
    id: `svc-${String(i)}`,
    name: `svc-${String(i)}`,
    container_id: `c-${String(i)}`,
    status: 'running',
    image_tag: 'demo:latest',
    image_url: null,
    assigned_port: null,
  }));

  const inspectContainer = vi
    .fn()
    .mockResolvedValue({ State: { Health: { Status: 'healthy' } } });
  const getContainerStats = vi.fn().mockResolvedValue(STATS_FIXTURE);

  const ctx = {
    db: {
      getProject: vi.fn((id: string) =>
        id === 'p1'
          ? {
              id: 'p1',
              name: 'demo',
              container_id: null,
              status: 'running',
              image_tag: null,
              image_url: null,
              assigned_port: null,
            }
          : null,
      ),
      getProjectByName: vi.fn(() => null),
      getChildProjects: vi.fn(() => children),
      findDependenciesByProject: vi.fn(() => []),
    },
    docker: {
      inspectContainer,
      getContainerStats,
    },
    eventBus: { on: vi.fn(), emit: vi.fn() },
  } as unknown as AppContext;

  return { ctx, inspectContainer, getContainerStats };
}

describe('project topology — per-container cache + in-flight dedupe (Blocker 4)', () => {
  beforeEach(() => {
    __test_resetTopologyNodeCache();
  });

  it('5 sequential rapid polls hit Docker once per service (TTL cache)', async () => {
    const { ctx, inspectContainer, getContainerStats } = buildCtx(3);
    const app = new Hono();
    app.route('/api', createProjectRoutes(ctx));

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/projects/p1/topology');
      expect(res.status).toBe(200);
    }

    // 3 services × 1 poll = 3 inspect + 3 stats. The next 4 polls
    // serve from cache → still 3 each.
    expect(inspectContainer).toHaveBeenCalledTimes(3);
    expect(getContainerStats).toHaveBeenCalledTimes(3);
  });

  it('concurrent polls collapse to one Docker call per service (in-flight dedupe)', async () => {
    const { ctx, inspectContainer, getContainerStats } = buildCtx(4);
    const app = new Hono();
    app.route('/api', createProjectRoutes(ctx));

    // Fire 5 polls concurrently before any of them resolves.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/projects/p1/topology')),
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    // 4 services × 1 round-trip = 4 inspect + 4 stats.
    expect(inspectContainer).toHaveBeenCalledTimes(4);
    expect(getContainerStats).toHaveBeenCalledTimes(4);
  });

  it('cache reset forces fresh Docker calls', async () => {
    const { ctx, inspectContainer } = buildCtx(2);
    const app = new Hono();
    app.route('/api', createProjectRoutes(ctx));

    await app.request('/api/projects/p1/topology');
    expect(inspectContainer).toHaveBeenCalledTimes(2);

    // Without reset: cached
    await app.request('/api/projects/p1/topology');
    expect(inspectContainer).toHaveBeenCalledTimes(2);

    __test_resetTopologyNodeCache();
    await app.request('/api/projects/p1/topology');
    expect(inspectContainer).toHaveBeenCalledTimes(4);
  });
});
