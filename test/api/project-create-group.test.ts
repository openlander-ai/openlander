import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { AppContext } from '../../src/app.js';
import { createDeployableServiceRoutes } from '../../src/web/api/deployable-service-routes.js';
import { createProjectGroupRoutes } from '../../src/web/api/project-group-routes.js';
import { createProjectRoutes } from '../../src/web/api/project-routes.js';
import { createServiceRuntimeRoutes } from '../../src/web/api/service-runtime-routes.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { ProjectAlreadyExistsError } from '../../src/errors.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
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
    id: 'api__svc',
    project_id: 'group-1',
    name: 'api__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'stopped',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: null,
    container_name: null,
    container_port: 3000,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: '.',
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/acme/api.git',
    branch: 'main',
    image_url: null,
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

function createTestApp(options: {
  existingProject?: ProjectRow;
  createProjectResult?: ProjectRow;
  createProjectGroupResult?: ProjectRow;
}) {
  const db = {
    getProjectByName: vi.fn(async () => options.existingProject),
    createProject: vi.fn(async () => options.createProjectResult ?? makeProjectRow()),
    createProjectGroup: vi.fn(async () => options.createProjectGroupResult ?? makeProjectRow()),
  };

  const app = new Hono();
  app.route('/api', createProjectGroupRoutes({ db } as unknown as AppContext));
  app.route('/api', createProjectRoutes({ db } as unknown as AppContext));
  return { app, db };
}

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createDeployableSplitApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createDeployableServiceRoutes(ctx as AppContext));
  app.route('/api', createServiceRuntimeRoutes(ctx as AppContext));
  app.route('/api', createProjectRoutes(ctx as AppContext));
  return app;
}

describe('POST /api/projects group creation', () => {
  it('creates a project group when only a name is provided', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({
        id: 'group-1',
        name: 'hotdeal-tracker',
        display_name: 'hotdeal-tracker',
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'hotdeal-tracker' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      project: {
        id: 'group-1',
        name: 'hotdeal-tracker',
        displayName: 'hotdeal-tracker',
        description: null,
        tags: [],
        status: 'idle',
      },
    });
    expect(db.createProjectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'hotdeal-tracker',
        displayName: 'hotdeal-tracker',
      }),
    );
    expect(db.createProject).not.toHaveBeenCalled();
  });

  it('derives a slug from displayName and stores display metadata', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({
        id: 'group-3',
        name: 'hotdeal-tracker',
        display_name: 'Hotdeal Tracker',
        description: 'Deal workspace',
        tags: JSON.stringify(['prod', 'api']),
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Hotdeal Tracker',
        description: 'Deal workspace',
        tags: ['prod', 'api', 'prod'],
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      project: {
        id: 'group-3',
        name: 'hotdeal-tracker',
        displayName: 'Hotdeal Tracker',
        description: 'Deal workspace',
        tags: ['prod', 'api'],
        status: 'idle',
      },
    });
    expect(db.createProjectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'hotdeal-tracker',
        displayName: 'Hotdeal Tracker',
        description: 'Deal workspace',
        tags: JSON.stringify(['prod', 'api']),
      }),
    );
  });

  it('uses name as explicit slug when name and displayName are both provided', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({
        id: 'group-mixed',
        name: 'explicit-slug',
        display_name: 'Readable Mixed Name',
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'explicit-slug', displayName: 'Readable Mixed Name' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.createProjectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'explicit-slug',
        displayName: 'Readable Mixed Name',
      }),
    );
  });

  it('suffixes a derived slug when the database reports a unique conflict', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({
        id: 'group-4',
        name: 'hotdeal-tracker-2',
        display_name: 'Hotdeal Tracker',
      }),
    });
    db.createProjectGroup
      .mockRejectedValueOnce(new ProjectAlreadyExistsError('hotdeal-tracker'))
      .mockResolvedValueOnce(
        makeProjectRow({
          id: 'group-4',
          name: 'hotdeal-tracker-2',
          display_name: 'Hotdeal Tracker',
        }),
      );

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Hotdeal Tracker' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.createProjectGroup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'hotdeal-tracker' }),
    );
    expect(db.createProjectGroup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'hotdeal-tracker-2' }),
    );
  });

  it('rejects project-level source fields when repo_url is provided', async () => {
    const { app, db } = createTestApp({
      createProjectResult: makeProjectRow({
        id: 'repo-1',
        name: 'repo-app',
        status: 'stopped',
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        repo_url: ' https://github.com/acme/repo-app.git ',
        branch: ' main ',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_SOURCE_REMOVED',
      code: 'PROJECT_SOURCE_REMOVED',
    });
    expect(db.createProject).not.toHaveBeenCalled();
    expect(db.createProjectGroup).not.toHaveBeenCalled();
  });

  it('rejects an empty body because group creation needs a name', async () => {
    const { app, db } = createTestApp({});

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
    });
    expect(db.createProject).not.toHaveBeenCalled();
    expect(db.createProjectGroup).not.toHaveBeenCalled();
  });

  it('treats a blank repo_url as group creation when name is present', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({
        id: 'group-2',
        name: 'manual-group',
        display_name: 'manual-group',
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'manual-group', repo_url: '   ' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.createProjectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: 'manual-group',
        displayName: 'manual-group',
      }),
    );
    expect(db.createProject).not.toHaveBeenCalled();
  });

  it('rejects attempts to mutate the immutable project slug', async () => {
    const project = makeProjectRow({ id: 'group-5', name: 'stable-slug' });
    const db = {
      getProject: vi.fn(async () => project),
      isCircuitBreakerOpen: vi.fn(async () => false),
      getDeployableForProject: vi.fn(async () => undefined),
      updateProject: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route('/api', createProjectGroupRoutes({ db } as unknown as AppContext));

    const res = await app.request('/api/projects/group-5', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'new-slug' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_SLUG_IMMUTABLE',
      code: 'PROJECT_SLUG_IMMUTABLE',
    });
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('updates display metadata without changing the slug', async () => {
    const project = makeProjectRow({ id: 'group-6', name: 'stable-slug' });
    const updated = makeProjectRow({
      id: 'group-6',
      name: 'stable-slug',
      display_name: 'Readable Name',
      description: 'Group description',
      tags: JSON.stringify(['frontend', 'prod']),
    });
    const db = {
      getProject: vi.fn().mockResolvedValueOnce(project).mockResolvedValueOnce(updated),
      isCircuitBreakerOpen: vi.fn(async () => false),
      getServices: vi.fn(async () => []),
      getDeployableForProject: vi.fn(async () => undefined),
      updateProject: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route('/api', createProjectGroupRoutes({ db } as unknown as AppContext));

    const res = await app.request('/api/projects/group-6', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: 'Readable Name',
        description: 'Group description',
        tags: ['frontend', 'prod'],
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.updateProject).toHaveBeenCalledWith(
      'group-6',
      expect.objectContaining({
        displayName: 'Readable Name',
        description: 'Group description',
        tags: JSON.stringify(['frontend', 'prod']),
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      name: 'stable-slug',
      displayName: 'Readable Name',
      description: 'Group description',
      tags: ['frontend', 'prod'],
    });
  });

  it.each(['start', 'stop', 'redeploy', 'rollback', 'blue-green'])(
    'returns 410 for removed project-level %s runtime route',
    async (action) => {
      const { app } = createTestApp({});

      const res = await app.request(`/api/projects/group-1/${action}`, { method: 'POST' });

      expect(res.status).toBe(410);
      await expect(res.json()).resolves.toMatchObject({
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
      });
    },
  );

  it('service deploy route targets the selected service runtime project', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const runtime = makeProjectRow({ id: 'api', name: 'api' });
    const service = {
      id: 'api__svc',
      name: 'api__svc',
      project_id: group.id,
      kind: 'app',
      source: 'git',
      repo_url: 'https://github.com/acme/api.git',
      container_id: 'container-1',
      status: 'running',
    };
    const db = {
      getProject: vi.fn(async (id: string) =>
        id === group.id ? group : id === runtime.id ? runtime : undefined,
      ),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === runtime.id ? service : undefined,
      ),
      isCircuitBreakerOpen: vi.fn(async () => false),
      updateProject: vi.fn(async () => undefined),
    };
    const pipeline = {
      redeploy: vi.fn(async () => ({ success: true, projectId: runtime.id })),
      redeployService: vi.fn(async () => ({ success: true, projectId: runtime.id })),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        pipeline,
        env: { set: vi.fn(), setBulkForService: vi.fn(async () => true) },
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(db.updateProject).toHaveBeenCalledWith(runtime.id, { status: 'building' });
    expect(pipeline.redeployService).toHaveBeenCalledWith(
      service.id,
      expect.objectContaining({ noCache: undefined, strategy: 'force' }),
    );
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      projectId: group.id,
      serviceId: service.id,
    });
  });

  it('updates source settings on the selected service row', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    let service = makeServiceRow({ project_id: group.id });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      getEnvironmentsByProject: vi.fn(async () => []),
      updateService: vi.fn(async (_id: string, updates: Record<string, unknown>) => {
        service = {
          ...service,
          repo_url: updates.repoUrl as string | null,
          branch: updates.branch as string | null,
          dockerfile_path: updates.dockerfilePath as string | null,
          docker_target: updates.dockerTarget as string | null,
          build_context: updates.buildContext as string | null,
          build_method: updates.buildMethod as ServiceRow['build_method'],
        };
      }),
      updateProject: vi.fn(async () => undefined),
    };
    const app = createDeployableSplitApp({ db } as unknown as AppContext);

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoUrl: 'https://github.com/acme/updated.git',
        branch: 'develop',
        dockerfilePath: 'apps/api/Dockerfile',
        dockerTarget: 'api',
        buildContext: 'apps/api',
        buildMethod: 'dockerfile',
      }),
    });

    expect(res.status).toBe(200);
    expect(db.updateService).toHaveBeenCalledWith(
      service.id,
      expect.objectContaining({
        repoUrl: 'https://github.com/acme/updated.git',
        branch: 'develop',
        dockerfilePath: 'apps/api/Dockerfile',
        dockerTarget: 'api',
        buildContext: 'apps/api',
        buildMethod: 'dockerfile',
      }),
    );
    expect(db.updateProject).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      service: {
        id: service.id,
        repoUrl: 'https://github.com/acme/updated.git',
        branch: 'develop',
        dockerfilePath: 'apps/api/Dockerfile',
      },
    });
  });

  it('rejects invalid service container port updates', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({ project_id: group.id, source: 'image', kind: 'image' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      updateService: vi.fn(async () => undefined),
    };
    const app = createDeployableSplitApp({ db } as unknown as AppContext);

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerPort: 70000 }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
    });
    expect(db.updateService).not.toHaveBeenCalled();
  });
});

describe('project route split hygiene', () => {
  it('keeps the legacy project route module as a compatibility shim only', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).toContain('createProjectCompatRoutes as createProjectRoutes');
    expect(projectRoutesSource).not.toContain('new Hono');
    expect(projectRoutesSource).not.toContain('api.');
  });

  it('keeps group CRUD and lifecycle handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.post('/projects'");
    expect(projectRoutesSource).not.toContain("api.get('/projects',");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id',");
    expect(projectRoutesSource).not.toContain("api.patch('/projects/:id'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/archive'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/unarchive'");
    expect(projectRoutesSource).not.toContain("api.delete('/projects/:id/purge'");
    expect(projectRoutesSource).not.toContain("api.delete('/projects/:id',");
  });

  it('keeps deployable service read/config handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/services'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s'");
    expect(projectRoutesSource).not.toContain("api.patch('/projects/:p/services/:s'");
  });

  it('keeps service env handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/env'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/env'");
    expect(projectRoutesSource).not.toContain("api.delete('/projects/:p/services/:s/env/:key'");
  });

  it('keeps service log handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/logs'");
  });

  it('keeps deployment read handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/deployments'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/deployments/:deployId'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/deployments'");
    expect(projectRoutesSource).not.toContain("api.get('/deployments/recent'");
  });

  it('keeps service runtime handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.delete('/projects/:p/services/:s/instance'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/start'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/stop'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/restart'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/deploy'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/rollback'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/archive'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/unarchive'");
  });

  it('keeps service aux handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/stats'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/topology'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/expose'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/unexpose'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/webhooks'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:p/services/:s/webhooks'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/services/:s/previews'");
  });

  it('keeps service connection and managed-service alias handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/services/:serviceId'");
    expect(projectRoutesSource).not.toContain("api.delete('/projects/:id/services/:serviceId'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:p/managed-services'");
    expect(projectRoutesSource).not.toContain("api.get('/managed-services/:id'");
    expect(projectRoutesSource).not.toContain("api.use('/services/:id'");
  });

  it('keeps project environment compatibility handlers out of the legacy project route module', () => {
    const projectRoutesSource = readRepoFile('src/web/api/project-routes.ts');

    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/environments'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/environments'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/environments/:envId'");
    expect(projectRoutesSource).not.toContain("api.delete('/projects/:id/environments/:envId'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/environments/:envId/env'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/environments/:envId/env'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/env'");
    expect(projectRoutesSource).not.toContain("api.get('/projects/:id/env-example'");
    expect(projectRoutesSource).not.toContain("api.post('/projects/:id/env'");
  });
});

describe('DELETE /api/projects/:p/services/:s/instance', () => {
  it('accepts the user-facing confirmation slug when the backing service name has __svc suffix', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({
      id: 'api__svc',
      project_id: group.id,
      name: 'api__svc',
    });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      listServiceConsumersForProvider: vi.fn(async () => []),
      findProjectDependents: vi.fn(async () => []),
      getDomainMappingsForService: vi.fn(async () => []),
      deleteDomainMappingsByService: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      deleteProjectDependenciesByService: vi.fn(async () => undefined),
      deleteService: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        docker: {},
        cloudflare: {},
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api' }),
    });

    expect(res.status).toBe(200);
    expect(db.deleteService).toHaveBeenCalledWith(service.id);
  });

  it('deletes a deployable service with typed confirmation and preserves volumes by default', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({
      id: 'api__svc',
      project_id: group.id,
      name: 'api',
      container_id: 'container-1',
      container_name: 'ol-api',
    });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      listServiceConsumersForProvider: vi.fn(async () => []),
      findProjectDependents: vi.fn(async () => []),
      getDomainMappingsForService: vi.fn(async () => [
        {
          id: 'domain-1',
          service_id: service.id,
          domain: 'api.example.com',
          cloudflare_zone_id: null,
          cloudflare_dns_record_id: null,
          status: 'active',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
      deleteDomainMapping: vi.fn(async () => undefined),
      deleteDomainMappingsByService: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      deleteProjectDependenciesByService: vi.fn(async () => undefined),
      deleteService: vi.fn(async () => undefined),
    };
    const docker = {
      stopContainer: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      listVolumes: vi.fn(async () => []),
      removeVolume: vi.fn(async () => undefined),
    };
    const cloudflare = {
      removeTunnelForService: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        docker,
        cloudflare,
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api' }),
    });

    expect(res.status).toBe(200);
    expect(cloudflare.removeTunnelForService).toHaveBeenCalledWith(service.id, 'api.example.com');
    expect(docker.stopContainer).toHaveBeenCalledWith('container-1');
    expect(docker.removeContainer).toHaveBeenCalledWith('container-1');
    expect(docker.listVolumes).not.toHaveBeenCalled();
    expect(db.deleteService).toHaveBeenCalledWith(service.id);
    await expect(res.json()).resolves.toMatchObject({
      status: 'deleted',
      volumes: { preserved: true, deleted: [] },
    });
  });

  it('removes managed volumes only when explicitly requested and no sibling deployables remain', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({ id: 'api__svc', project_id: group.id, name: 'api' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      listServiceConsumersForProvider: vi.fn(async () => []),
      findProjectDependents: vi.fn(async () => []),
      getDomainMappingsForService: vi.fn(async () => []),
      deleteDomainMappingsByService: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      deleteProjectDependenciesByService: vi.fn(async () => undefined),
      deleteService: vi.fn(async () => undefined),
    };
    const docker = {
      listVolumes: vi.fn(async () => [{ Name: 'ol_workspace_data' }]),
      removeVolume: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        docker,
        cloudflare: {},
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api', deleteVolumes: true }),
    });

    expect(res.status).toBe(200);
    expect(docker.listVolumes).toHaveBeenCalled();
    expect(docker.removeVolume).toHaveBeenCalledWith('ol_workspace_data');
    await expect(res.json()).resolves.toMatchObject({
      volumes: { preserved: false, deleted: ['ol_workspace_data'], skippedReason: null },
    });
  });

  it('skips volume removal when sibling deployables still share the group', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({ id: 'api__svc', project_id: group.id, name: 'api' });
    const sibling = makeServiceRow({ id: 'worker__svc', project_id: group.id, name: 'worker' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      listServiceConsumersForProvider: vi.fn(async () => []),
      findProjectDependents: vi.fn(async () => []),
      getDomainMappingsForService: vi.fn(async () => []),
      deleteDomainMappingsByService: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service, sibling]),
      deleteProjectDependenciesByService: vi.fn(async () => undefined),
      deleteService: vi.fn(async () => undefined),
    };
    const docker = {
      listVolumes: vi.fn(async () => [{ Name: 'ol_workspace_data' }]),
      removeVolume: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        docker,
        cloudflare: {},
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api', deleteVolumes: true }),
    });

    expect(res.status).toBe(200);
    expect(docker.listVolumes).not.toHaveBeenCalled();
    expect(docker.removeVolume).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      volumes: { deleted: [], preserved: true, skippedReason: 'PROJECT_HAS_SIBLING_SERVICES' },
    });
  });

  it('blocks deletion when another service consumes the target', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({ id: 'db__svc', project_id: group.id, name: 'db' });
    const consumer = makeServiceRow({ id: 'api__svc', project_id: group.id, name: 'api' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === group.id ? group : undefined)),
      getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
      getService: vi.fn(async (id: string) =>
        id === service.id ? service : id === consumer.id ? consumer : undefined,
      ),
      listServiceConsumersForProvider: vi.fn(async () => [
        {
          id: 'conn-1',
          service_id_consumer: consumer.id,
          service_id_provider: service.id,
          environment_id: null,
          auto_injected_env_keys: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
      findProjectDependents: vi.fn(async () => []),
      deleteService: vi.fn(async () => undefined),
    };
    const app = new Hono();
    app.route(
      '/api',
      createServiceRuntimeRoutes({
        db,
        docker: {},
        cloudflare: {},
        coordinator: { suppressProject: vi.fn() },
      } as unknown as AppContext),
    );

    const res = await app.request(`/api/projects/${group.id}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/db' }),
    });

    expect(res.status).toBe(409);
    expect(db.deleteService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'SERVICE_HAS_CONSUMERS',
      details: {
        serviceId: service.id,
        serviceName: service.name,
      },
    });
  });
});

describe('DELETE /api/projects/:id cascade block', () => {
  function buildDeletionApp(project: ProjectRow, deployables: ServiceRow[]) {
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async (name: string) =>
        name === project.name ? project : undefined,
      ),
      getDeployableForProject: vi.fn(() => undefined),
      getDeployablesByGroup: vi.fn(async () => deployables),
      isCircuitBreakerOpen: vi.fn(() => false),
    };
    const pipeline = {
      remove: vi.fn(async () => undefined),
      archive: vi.fn(async () => undefined),
    };
    const coordinator = { suppressProject: vi.fn() };
    const app = new Hono();
    app.route(
      '/api',
      createProjectGroupRoutes({
        db,
        pipeline,
        coordinator,
        cloudflare: {},
      } as unknown as AppContext),
    );
    return { app, pipeline };
  }

  it.each([
    ['DELETE /api/projects/:id', '/api/projects/group-1'],
    ['DELETE /api/projects/:id/purge', '/api/projects/group-1/purge?confirm=true'],
  ])('%s returns PROJECT_HAS_ACTIVE_SERVICES while deployable services exist', async (_, path) => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const service = makeServiceRow({
      id: 'api__svc',
      project_id: group.id,
      name: 'api__svc',
      status: 'running',
    });
    const { app, pipeline } = buildDeletionApp(group, [service]);

    const res = await app.request(path, { method: 'DELETE' });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_HAS_ACTIVE_SERVICES',
      code: 'PROJECT_HAS_ACTIVE_SERVICES',
      details: {
        projectId: group.id,
        projectName: group.name,
        blockers: [
          {
            serviceId: service.id,
            serviceName: 'api',
            slug: 'workspace/api',
            kind: service.kind,
            status: 'running',
          },
        ],
      },
    });
    expect(pipeline.remove).not.toHaveBeenCalled();
  });

  it('DELETE /api/projects/:id hard-deletes when no deployable services remain', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const { app, pipeline } = buildDeletionApp(group, []);

    const res = await app.request('/api/projects/group-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(pipeline.remove).toHaveBeenCalledWith(group.id, {});
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      message: 'Project permanently deleted',
    });
  });
});
