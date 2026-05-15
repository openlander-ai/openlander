import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import type { ServiceMetricRow } from '../../src/db/schema.drizzle.js';
import { createMonitoringRoutes } from '../../src/web/api/monitoring-routes.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'demo-stack',
    name: 'demo-stack',
    display_name: 'demo-stack',
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
    id: 'demo-stack__svc',
    project_id: 'demo-stack',
    name: 'demo-stack/app',
    kind: 'compose-child',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10006,
    container_id: 'container-app',
    container_name: 'ol-demo-stack-app',
    container_port: 3000,
    image_tag: 'ol-demo-stack-app:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'git',
    repo_url: null,
    branch: null,
    image_url: 'ol-demo-stack-app:latest',
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeMetric(serviceId: string, recordedAt = Date.now() - 1000): ServiceMetricRow {
  return {
    service_id: serviceId,
    recorded_at: recordedAt,
    cpu: 1.2,
    mem: 48,
    req: 0,
    err: 0,
    p95_latency_ms: null,
    request_count: 0,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createMonitoringRoutes(ctx as AppContext));
  return app;
}

describe('createMonitoringRoutes', () => {
  it('returns only services attached to visible project groups', async () => {
    const visibleProject = makeProjectRow();
    const services = [
      makeServiceRow({ id: 'demo-stack-app', name: 'demo-stack/app', kind: 'compose-child' }),
      makeServiceRow({ id: 'demo-stack-redis', name: 'demo-stack/redis', kind: 'redis' }),
      makeServiceRow({ id: 'demo-stack-postgres', name: 'demo-stack/postgres', kind: 'postgres' }),
      makeServiceRow({ id: 'demo-stack__svc', name: 'demo-stack', kind: 'compose' }),
      makeServiceRow({
        id: 'orphan-postgres',
        project_id: '__orphan_managed',
        name: 'postgresql-1778777639974',
        kind: 'postgres',
      }),
      makeServiceRow({
        id: 'archived-app',
        name: 'archived-app',
        kind: 'image',
        archived_at: '2026-01-01T01:00:00.000Z',
      }),
    ];
    const db = {
      listServices: vi.fn(async () => services),
      listProjects: vi.fn(async () => [visibleProject]),
      hasAnyServiceMetrics: vi.fn(async () => true),
      listServiceMetricsSince: vi.fn(async (serviceId: string) => [makeMetric(serviceId)]),
      getLastServiceMetricAt: vi.fn(async () => Date.now() - 1000),
    };
    const app = createApp({ db });

    const res = await app.request('/api/monitoring/services');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      services: Array<{ serviceId: string; projectId: string | null; projectName: string | null }>;
      total: number;
      excluded: number;
    };
    expect(body.total).toBe(3);
    expect(body.excluded).toBe(0);
    expect(body.services.map((service) => service.serviceId)).toEqual([
      'demo-stack-app',
      'demo-stack-redis',
      'demo-stack-postgres',
    ]);
    expect(body.services.every((service) => service.projectId === 'demo-stack')).toBe(true);
    expect(body.services.every((service) => service.projectName === 'demo-stack')).toBe(true);
  });

  it('applies project filtering using the canonical service project_id', async () => {
    const services = [
      makeServiceRow({ id: 'demo-stack-app', project_id: 'demo-stack' }),
      makeServiceRow({ id: 'other-app', project_id: 'other-project', name: 'other/app' }),
    ];
    const db = {
      listServices: vi.fn(async () => services),
      listProjects: vi.fn(async () => [
        makeProjectRow({ id: 'demo-stack', name: 'demo-stack' }),
        makeProjectRow({ id: 'other-project', name: 'other-project' }),
      ]),
      hasAnyServiceMetrics: vi.fn(async () => true),
      listServiceMetricsSince: vi.fn(async (serviceId: string) => [makeMetric(serviceId)]),
      getLastServiceMetricAt: vi.fn(async () => Date.now() - 1000),
    };
    const app = createApp({ db });

    const res = await app.request('/api/monitoring/services?project=demo-stack');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      services: Array<{ serviceId: string; projectId: string | null }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.services).toEqual([expect.objectContaining({ serviceId: 'demo-stack-app' })]);
  });
});
