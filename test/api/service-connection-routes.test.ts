import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createServiceConnectionRoutes } from '../../src/web/api/service-connection-routes.js';

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
    id: 'svc-pg',
    project_id: '__managed',
    name: 'postgres-main',
    kind: 'postgres',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 5432,
    container_id: 'pg-container',
    container_name: 'ol-svc-postgres-main',
    container_port: 5432,
    image_tag: 'postgres:15',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'postgres:15',
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: null,
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

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createServiceConnectionRoutes(ctx as AppContext));
  return app;
}

describe('createServiceConnectionRoutes', () => {
  it('connects a managed service, injects env, and creates an auto dependency', async () => {
    const project = makeProjectRow();
    const managed = makeServiceRow({ credentials: JSON.stringify({ username: 'postgres' }) });
    const deployable = makeServiceRow({ id: 'group-1__svc', project_id: project.id, kind: 'git' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async () => undefined),
      getService: vi.fn(async (id: string) => (id === managed.id ? managed : undefined)),
      getServiceConnectionByProjectAndService: vi.fn(async () => undefined),
      createServiceConnection: vi.fn(async () => ({
        id: 'conn-1',
        created_at: '2026-01-02T00:00:00.000Z',
      })),
      updateServiceConnection: vi.fn(async () => undefined),
      listServiceConnectionsByProject: vi.fn(async () => [
        { id: 'conn-1', service_id_provider: managed.id },
      ]),
      getDeployableForProject: vi.fn(async () => deployable),
      createProjectDependency: vi.fn(async () => undefined),
    };
    const env = {
      getAllForService: vi.fn(async () => ({})),
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({ db, env } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/svc-pg', { method: 'POST' });

    expect(res.status).toBe(201);
    expect(db.createServiceConnection).toHaveBeenCalledWith({
      projectId: 'group-1',
      serviceId: 'svc-pg',
    });
    expect(env.setBulkForService).toHaveBeenCalledWith('group-1', 'group-1__svc', {
      DATABASE_URL: 'postgresql://postgres:postgres@postgres-main:5432/app',
    });
    expect(db.updateServiceConnection).toHaveBeenCalledWith('conn-1', {
      autoInjectedEnvKeys: JSON.stringify(['DATABASE_URL']),
    });
    expect(db.createProjectDependency).toHaveBeenCalledWith({
      source_service_id: 'group-1__svc',
      target_service_id: 'svc-pg',
      dependency_type: 'database',
      source: 'auto',
    });
    await expect(res.json()).resolves.toMatchObject({
      id: 'conn-1',
      service: {
        id: 'svc-pg',
        name: 'postgres-main',
        type: 'postgresql',
        status: 'running',
        port: 5432,
        containerName: 'ol-svc-postgres-main',
      },
      autoInjectedEnvKeys: ['DATABASE_URL'],
    });
  });

  it('replaces placeholder connection env values during auto injection', async () => {
    const project = makeProjectRow();
    const managed = makeServiceRow({
      credentials: JSON.stringify({
        connectionString: 'postgresql://openlander:pw@ol-svc-postgres-main:5432/app',
      }),
    });
    const deployable = makeServiceRow({ id: 'group-1__svc', project_id: project.id, kind: 'git' });
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async () => undefined),
      getService: vi.fn(async (id: string) => (id === managed.id ? managed : undefined)),
      getServiceConnectionByProjectAndService: vi.fn(async () => undefined),
      createServiceConnection: vi.fn(async () => ({
        id: 'conn-1',
        created_at: '2026-01-02T00:00:00.000Z',
      })),
      updateServiceConnection: vi.fn(async () => undefined),
      listServiceConnectionsByProject: vi.fn(async () => [
        { id: 'conn-1', service_id_provider: managed.id },
      ]),
      getDeployableForProject: vi.fn(async () => deployable),
      createProjectDependency: vi.fn(async () => undefined),
    };
    const env = {
      getAllForService: vi.fn(async () => ({
        DATABASE_URL: 'postgresql://placeholder:placeholder@placeholder:5432/placeholder',
      })),
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({ db, env } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/svc-pg', { method: 'POST' });

    expect(res.status).toBe(201);
    expect(env.setBulkForService).toHaveBeenCalledWith('group-1', 'group-1__svc', {
      DATABASE_URL: 'postgresql://openlander:pw@ol-svc-postgres-main:5432/app',
    });
    expect(db.updateServiceConnection).toHaveBeenCalledWith('conn-1', {
      autoInjectedEnvKeys: JSON.stringify(['DATABASE_URL']),
    });
  });

  it('rejects duplicate service connections', async () => {
    const project = makeProjectRow();
    const managed = makeServiceRow();
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getService: vi.fn(async () => managed),
      getServiceConnectionByProjectAndService: vi.fn(async () => ({ id: 'conn-1' })),
      createServiceConnection: vi.fn(),
    };
    const app = createApp({ db } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/svc-pg', { method: 'POST' });

    expect(res.status).toBe(409);
    expect(db.createServiceConnection).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ error: 'ALREADY_CONNECTED' });
  });

  it('returns SERVICE_NOT_FOUND for missing managed service connection target', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
      },
    } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/missing', { method: 'POST' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'SERVICE_NOT_FOUND' });
  });

  it('disconnects a service and cleans auto-injected env/dependency metadata', async () => {
    const project = makeProjectRow();
    const deployable = makeServiceRow({ id: 'group-1__svc', project_id: project.id, kind: 'git' });
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getServiceConnectionByProjectAndService: vi.fn(async () => ({
        id: 'conn-1',
        auto_injected_env_keys: JSON.stringify(['DATABASE_URL', 123, 'REDIS_URL']),
      })),
      getDeployableForProject: vi.fn(async () => deployable),
      deleteServiceConnectionByProjectAndService: vi.fn(async () => undefined),
      findDependenciesByProject: vi.fn(async () => [
        { id: 'dep-1', target_service_id: 'svc-pg', source: 'auto' },
        { id: 'dep-2', target_service_id: 'svc-pg', source: 'manual' },
      ]),
      deleteProjectDependency: vi.fn(async () => undefined),
    };
    const env = { deleteForService: vi.fn(async () => true) };
    const app = createApp({ db, env } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/svc-pg', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(env.deleteForService).toHaveBeenCalledWith('group-1', 'group-1__svc', 'DATABASE_URL');
    expect(env.deleteForService).toHaveBeenCalledWith('group-1', 'group-1__svc', 'REDIS_URL');
    expect(env.deleteForService).toHaveBeenCalledTimes(2);
    expect(db.deleteServiceConnectionByProjectAndService).toHaveBeenCalledWith('group-1', 'svc-pg');
    expect(db.deleteProjectDependency).toHaveBeenCalledWith('dep-1');
    await expect(res.json()).resolves.toMatchObject({
      message: 'Service disconnected',
      serviceId: 'svc-pg',
    });
  });

  it('returns NOT_CONNECTED when deleting a missing connection', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getServiceConnectionByProjectAndService: vi.fn(async () => undefined),
      },
    } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/services/svc-pg', { method: 'DELETE' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'NOT_CONNECTED' });
  });

  it('lists connected managed services using legacy vocabulary', async () => {
    const project = makeProjectRow();
    const managed = makeServiceRow();
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async () => undefined),
      listServiceConnectionsByProject: vi.fn(async () => [
        { id: 'conn-1', service_id_provider: managed.id },
        { id: 'conn-missing', service_id_provider: 'missing' },
      ]),
      getService: vi.fn(async (id: string) => (id === managed.id ? managed : undefined)),
    };
    const app = createApp({ db } as Partial<AppContext>);

    const res = await app.request('/api/projects/group-1/managed-services');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual([
      {
        id: 'svc-pg',
        name: 'postgres-main',
        type: 'postgresql',
        status: 'running',
        port: 5432,
        containerName: 'ol-svc-postgres-main',
      },
    ]);
  });

  it('redirects legacy deployable detail aliases to canonical project service paths', async () => {
    const project = makeProjectRow();
    const db = {
      getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn(async () => undefined),
    };
    const app = createApp({ db } as Partial<AppContext>);

    const serviceRes = await app.request('/api/services/group-1', { redirect: 'manual' });

    expect(serviceRes.status).toBe(308);
    expect(serviceRes.headers.get('location')).toBe('/api/projects/group-1/services/group-1');
  });
});
