import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ServiceRow } from '../../src/db/types.js';
import { createProjectCompatRoutes } from '../../src/web/api/project-compat-routes.js';

function createApp(ctx: Partial<AppContext> = {}) {
  const app = new Hono();
  app.route('/api', createProjectCompatRoutes(ctx as AppContext));
  return app;
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'group-1__svc',
    project_id: 'group-1',
    name: 'group-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    container_name: 'ol-workspace',
    container_port: 3000,
    image_tag: 'ol-workspace:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: '.',
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

describe('createProjectCompatRoutes', () => {
  it('keeps project-level runtime actions removed with replacement hints', async () => {
    const app = createApp();

    const res = await app.request('/api/projects/group-1/redeploy', { method: 'POST' });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_RUNTIME_ACTION_REMOVED',
      code: 'PROJECT_RUNTIME_ACTION_REMOVED',
      replacement: 'POST /api/projects/:projectId/services/:serviceId/deploy',
    });
  });

  it('keeps project-level webhooks disabled', async () => {
    const app = createApp();

    const res = await app.request('/api/projects/group-1/webhooks');

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: 'FEATURE_DISABLED',
    });
  });

  it('validates question replies before resolving the bridge', async () => {
    const reply = vi.fn();
    const app = createApp({
      questionBridge: {
        hasPending: vi.fn(() => true),
        reply,
      },
    });

    const res = await app.request('/api/question/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'question-1',
        answers: [{ questionIndex: 0, selectedLabels: ['Use Dockerfile'], customText: 'ok' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(reply).toHaveBeenCalledWith('question-1', [
      { questionIndex: 0, selectedLabels: ['Use Dockerfile'], customText: 'ok' },
    ]);
    await expect(res.json()).resolves.toEqual({ status: 'answered' });
  });

  it('returns project-level logs through the legacy compatibility endpoint', async () => {
    const project = { id: 'group-1', name: 'workspace', container_id: null, status: 'running' };
    const getProject = vi.fn(async (id: string) => (id === project.id ? project : undefined));
    const getProjectByName = vi.fn(async () => undefined);
    const getDeployableForProject = vi.fn(async () => undefined);
    const getLogs = vi.fn(async () => ['line-1', 'line-2']);
    const app = createApp({
      db: { getProject, getProjectByName, getDeployableForProject },
      pipeline: { getLogs },
    });

    const res = await app.request('/api/projects/group-1/logs?lines=2');

    expect(res.status).toBe(200);
    expect(getLogs).toHaveBeenCalledWith('group-1', 2, { timestamps: true });
    await expect(res.json()).resolves.toEqual({
      project: 'workspace',
      logs: ['line-1', 'line-2'],
    });
  });

  it('does not fabricate a service topology node for empty project groups', async () => {
    const project = { id: 'group-1', name: 'workspace', container_id: null, status: null };
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
        getComposeChildProjects: vi.fn(async () => []),
        getChildProjects: vi.fn(async () => []),
        getEnvironmentsByProject: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => null),
        findDependenciesByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ services: [] });
  });

  it('keeps the legacy single-node topology fallback when a backing deployable exists', async () => {
    const project = { id: 'legacy-1', name: 'legacy-app', container_id: null, status: null };
    const deployable = {
      id: 'legacy-1__svc',
      name: 'legacy-app__svc',
      assigned_port: 10001,
      image_url: null,
      image_tag: 'legacy-app:latest',
      container_id: null,
      status: 'running',
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
        getComposeChildProjects: vi.fn(async () => []),
        getChildProjects: vi.fn(async () => []),
        getEnvironmentsByProject: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => deployable),
        findDependenciesByProject: vi.fn(async () => []),
        getLatestServiceMetric: vi.fn(async () => null),
      },
      docker: {
        inspectContainer: vi.fn(),
      },
    });

    const res = await app.request('/api/projects/legacy-1/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      services: [
        {
          id: 'legacy-1',
          name: 'legacy-app',
          image: 'legacy-app:latest',
          port: 10001,
          dependsOn: [],
        },
      ],
    });
  });

  it('uses route-safe URLs for HTTP compose children and hides internal dependencies', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    process.env['OPENLANDER_PUBLIC_HOST'] = 'localhost';
    const project = { id: 'stack', name: 'demo-stack', container_id: null, status: null };
    const appService = makeServiceRow({
      id: 'stack__app__svc',
      project_id: 'stack',
      name: 'demo-stack/app__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 10006,
      container_id: 'container-app',
      container_name: 'ol-demo-stack-app',
      image_url: 'ol-demo-stack-app:latest',
    });
    const postgresService = makeServiceRow({
      id: 'stack__postgres__svc',
      project_id: 'stack',
      name: 'demo-stack/postgres__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 10005,
      image_url: 'postgres:16-alpine',
    });
    const redisService = makeServiceRow({
      id: 'stack__redis__svc',
      project_id: 'stack',
      name: 'demo-stack/redis__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 10008,
      image_url: 'redis:7-alpine',
    });
    const app = createApp({
      docker: {
        inspectContainer: vi.fn(async () => ({
          Config: {
            Env: [
              'DATABASE_URL=postgresql://demo:demo@postgres:5432/demo',
              'REDIS_URL=redis://redis:6379',
            ],
          },
          State: { Health: { Status: 'healthy' } },
        })),
      } as unknown as AppContext['docker'],
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [appService, postgresService, redisService]),
        getEnvironmentsByProject: vi.fn(async () => []),
        findDependenciesByProject: vi.fn(async () => []),
        getLatestServiceMetric: vi.fn(async () => null),
      },
    });

    const res = await app.request('/api/projects/stack/topology').finally(() => {
      if (previousPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = previousPublicHost;
      }
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      services: [
        {
          id: 'stack__app__svc',
          name: 'demo-stack/app',
          url: 'http://demo-stack-app.localhost',
          dependsOn: ['stack__postgres__svc', 'stack__redis__svc'],
        },
        {
          id: 'stack__postgres__svc',
          name: 'demo-stack/postgres',
          url: null,
        },
        {
          id: 'stack__redis__svc',
          name: 'demo-stack/redis',
          url: null,
        },
      ],
    });
  });
});
