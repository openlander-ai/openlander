import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createDeployableServiceRoutes } from '../../src/web/api/deployable-service-routes.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'group-1',
    name: 'workspace',
    display_name: 'Workspace',
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
    id: 'group-1__svc',
    project_id: 'group-1',
    name: 'group-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: 'container-1',
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
    image_cmd: JSON.stringify(['nginx', '-g', 'daemon off;']),
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

function makeEnvironmentRow(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-1',
    service_id: 'group-1__svc',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: 10001,
    container_id: 'container-1',
    image_tag: 'ol-workspace:latest',
    previous_image_tag: null,
    public_url: null,
    container_port: 3000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createDeployableServiceRoutes(ctx as AppContext));
  return app;
}

describe('createDeployableServiceRoutes', () => {
  it('lists deployable services for a project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = makeEnvironmentRow();
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      getEnvironmentsByProject: vi.fn(async () => [env]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/group-1/services');

    expect(res.status).toBe(200);
    expect(db.getDeployablesByGroup).toHaveBeenCalledWith('group-1');
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      services: [
        {
          id: 'group-1__svc',
          name: 'group-1',
          source: 'image',
          imageCmd: ['nginx', '-g', 'daemon off;'],
          deployedBranch: 'main',
        },
      ],
    });
  });

  it('lists compose child services instead of compose parent metadata', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    process.env['OPENLANDER_PUBLIC_HOST'] = 'localhost';
    const project = makeProjectRow({ id: 'stack', name: 'demo-stack' });
    const composeChildren = [
      makeServiceRow({
        id: 'stack__web__svc',
        name: 'demo-stack/web__svc',
        project_id: 'stack',
        kind: 'compose-child',
        parent_service_id: 'stack__svc',
        assigned_port: 10006,
        image_url: 'ol-demo-stack-web:latest',
      }),
      makeServiceRow({
        id: 'stack__postgres__svc',
        name: 'demo-stack/postgres__svc',
        project_id: 'stack',
        kind: 'compose-child',
        parent_service_id: 'stack__svc',
        assigned_port: 10005,
        image_url: 'postgres:16-alpine',
      }),
    ];
    const getDeployablesByGroup = vi.fn(async () => composeChildren);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup,
        getEnvironmentsByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/stack/services').finally(() => {
      if (previousPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = previousPublicHost;
      }
    });

    expect(res.status).toBe(200);
    expect(getDeployablesByGroup).toHaveBeenCalledWith('stack');
    await expect(res.json()).resolves.toMatchObject({
      count: 2,
      services: [
        {
          id: 'stack__web__svc',
          name: 'demo-stack/web',
          kind: 'compose-child',
          url: 'http://demo-stack-web.localhost',
        },
        {
          id: 'stack__postgres__svc',
          name: 'demo-stack/postgres',
          kind: 'compose-child',
          url: null,
        },
      ],
    });
  });

  it('preserves PROJECT_NOT_FOUND shape on service list project misses', async () => {
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
      },
    });

    const res = await app.request('/api/projects/missing/services');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_NOT_FOUND',
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found: missing',
      details: { identifier: 'missing' },
    });
  });

  it('returns service detail with service-scoped env vars and recent deploys', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = makeEnvironmentRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getEnvironmentsByProject: vi.fn(async () => [env]),
        getDeployLogs: vi.fn(async () => [{ id: 'deploy-1', commit_message: 'Ship it' }]),
        getDeployableForProject: vi.fn(async () => service),
      },
      env: {
        getAllForService: vi.fn(async () => [{ key: 'DATABASE_URL', value: 'postgres://db' }]),
        getAll: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'group-1',
      service: {
        id: 'group-1__svc',
        name: 'group-1',
        deployedBranch: 'main',
      },
      envVars: [{ key: 'DATABASE_URL', value: 'postgres://db' }],
      recentDeploys: [{ id: 'deploy-1', commitMessage: 'Ship it' }],
    });
  });

  it('updates service source/build fields', async () => {
    const project = makeProjectRow();
    const original = makeServiceRow();
    const updated = makeServiceRow({
      source: 'git',
      repo_url: 'github.com/openlander-ai/demo',
      branch: 'develop',
      image_url: null,
      image_cmd: JSON.stringify(['npm', 'start']),
      container_port: 8080,
    });
    const updateService = vi.fn(async () => undefined);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => {
          if (id !== original.id) return undefined;
          return updateService.mock.calls.length === 0 ? original : updated;
        }),
        updateService,
        getEnvironmentsByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        imageUrl: null,
        imageCmd: ['npm', 'start'],
        containerPort: '8080',
      }),
    });

    expect(res.status).toBe(200);
    expect(updateService).toHaveBeenCalledWith(
      'group-1__svc',
      expect.objectContaining({
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        imageUrl: null,
        imageCmd: JSON.stringify(['npm', 'start']),
        containerPort: 8080,
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      service: {
        id: 'group-1__svc',
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        containerPort: 8080,
      },
    });
  });

  it('rejects invalid PATCH fields before updating the service', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const updateService = vi.fn(async () => undefined);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
        updateService,
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerPort: 70000 }),
    });

    expect(res.status).toBe(400);
    expect(updateService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'containerPort must be between 1 and 65535',
    });
  });

  it('does not allow a service from another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });

  it('rejects service detail when the service belongs to another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });
});
