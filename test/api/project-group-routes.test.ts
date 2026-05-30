import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { ProjectAlreadyExistsError } from '../../src/errors.js';
import { createProjectGroupRoutes } from '../../src/web/api/project-group-routes.js';

const ORIGINAL_HOST_IP = process.env['HOST_IP'];

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

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createProjectGroupRoutes(ctx as AppContext));
  return app;
}

describe('createProjectGroupRoutes', () => {
  beforeEach(() => {
    process.env['HOST_IP'] = '192.0.2.10';
    delete process.env['HOST_VPN_IP'];
  });

  afterEach(() => {
    if (ORIGINAL_HOST_IP === undefined) {
      delete process.env['HOST_IP'];
    } else {
      process.env['HOST_IP'] = ORIGINAL_HOST_IP;
    }
  });

  it('preserves environment url fields on GET /api/projects', async () => {
    const project = makeProjectRow({
      display_name: 'Readable Workspace',
      description: 'Public API surface',
      tags: JSON.stringify(['api', 'production']),
    });
    const env = makeEnvironmentRow();
    const app = createApp({
      db: {
        listProjectsWithMetadata: vi.fn(async () => [
          {
            project,
            environments: [env],
            childCount: 1,
            isCompose: false,
            partiallyArchived: false,
          },
        ]),
      },
    });

    const res = await app.request('/api/projects');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      projects: [
        {
          id: project.id,
          displayName: 'Readable Workspace',
          display_name: 'Readable Workspace',
          description: 'Public API surface',
          tags: ['api', 'production'],
          url: null,
          urls: [],
          partiallyArchived: false,
          partially_archived: false,
          environments: [
            {
              id: env.id,
              url: 'http://workspace.192.0.2.10.sslip.io',
              urls: expect.arrayContaining([
                expect.objectContaining({
                  url: 'http://workspace.192.0.2.10.sslip.io',
                  type: 'lan',
                  ip: '192.0.2.10',
                }),
              ]),
            },
          ],
        },
      ],
    });
  });

  it('preserves project and environment url fields on GET /api/projects/:id', async () => {
    const project = makeProjectRow();
    const env = makeEnvironmentRow();
    const service = makeServiceRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getEnvironmentsByProject: vi.fn(async () => [env]),
        getDeployLogs: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => service),
        getDeployablesByGroup: vi.fn(async () => [service]),
      },
      env: { getAll: vi.fn(async () => []) },
    });

    const res = await app.request('/api/projects/group-1');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: project.id,
      port: 10001,
      url: 'http://workspace.192.0.2.10.sslip.io',
      urls: expect.arrayContaining([
        expect.objectContaining({
          url: 'http://workspace.192.0.2.10.sslip.io',
          type: 'lan',
          ip: '192.0.2.10',
        }),
      ]),
      environments: [
        {
          id: env.id,
          url: 'http://workspace.192.0.2.10.sslip.io',
          urls: expect.arrayContaining([
            expect.objectContaining({
              url: 'http://workspace.192.0.2.10.sslip.io',
              type: 'lan',
              ip: '192.0.2.10',
            }),
          ]),
        },
      ],
    });
  });

  it('reports a partial group without exposing the group as archived on detail', async () => {
    const archivedAt = '2026-02-01T00:00:00.000Z';
    const project = makeProjectRow({ archived_at: archivedAt });
    const primary = makeServiceRow({ archived_at: archivedAt });
    const worker = makeServiceRow({
      id: 'worker__svc',
      name: 'worker__svc',
      archived_at: null,
      status: 'running',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getEnvironmentsByProject: vi.fn(async () => []),
        getDeployLogs: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => primary),
        getDeployablesByGroup: vi.fn(async () => [primary, worker]),
      },
      env: { getAll: vi.fn(async () => []) },
    });

    const res = await app.request('/api/projects/group-1');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: project.id,
      archived_at: null,
      partiallyArchived: true,
      partially_archived: true,
    });
  });

  it('exercises POST /api/projects through the new group route module', async () => {
    const created = makeProjectRow({
      id: 'group-2',
      name: 'new-workspace',
      display_name: 'New Workspace',
      tags: JSON.stringify(['prod']),
    });
    const db = {
      createProjectGroup: vi.fn(async () => created),
      getProjectByName: vi.fn(async () => undefined),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'New Workspace', tags: ['prod'] }),
    });

    expect(res.status).toBe(200);
    expect(db.createProjectGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new-workspace',
        displayName: 'New Workspace',
        tags: JSON.stringify(['prod']),
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      project: {
        id: created.id,
        name: created.name,
        displayName: created.display_name,
        tags: ['prod'],
      },
    });
  });

  it('returns the existing project id when an explicit slug collides', async () => {
    const existing = makeProjectRow({ id: 'existing-1', name: 'workspace' });
    const db = {
      createProjectGroup: vi.fn(async () => {
        throw new ProjectAlreadyExistsError('workspace');
      }),
      getProjectByName: vi.fn(async () => existing),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'workspace' }),
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      code: 'PROJECT_ALREADY_EXISTS',
      projectId: existing.id,
    });
  });

  it('rejects project source fields through the new group route module', async () => {
    const db = {
      createProjectGroup: vi.fn(async () => makeProjectRow()),
      getProjectByName: vi.fn(async () => undefined),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'repo-app', repo_url: 'https://github.com/acme/repo.git' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: 'PROJECT_SOURCE_REMOVED',
    });
    expect(db.createProjectGroup).not.toHaveBeenCalled();
  });

  it('rejects immutable slug changes on PATCH /api/projects/:id', async () => {
    const project = makeProjectRow();
    const db = {
      getProject: vi.fn(async () => project),
      updateProject: vi.fn(async () => undefined),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/group-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: 'PROJECT_SLUG_IMMUTABLE',
    });
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('requires confirmation for DELETE /api/projects/:id/purge', async () => {
    const app = createApp({ db: {} });

    const res = await app.request('/api/projects/group-1/purge', { method: 'DELETE' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Confirmation required. Add ?confirm=true to permanently delete.',
    });
  });

  it('uses group lifecycle methods for project archive and unarchive routes', async () => {
    const project = makeProjectRow();
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => makeServiceRow()),
      getDeployablesByGroup: vi.fn(async () => [makeServiceRow()]),
      isCircuitBreakerOpen: vi.fn(async () => false),
    };
    const pipeline = {
      archiveGroup: vi.fn(async () => undefined),
      unarchiveGroup: vi.fn(async () => undefined),
      archive: vi.fn(async () => undefined),
      unarchive: vi.fn(async () => undefined),
    };
    const coordinator = { suppressProject: vi.fn() };
    const app = createApp({ db, pipeline, coordinator });

    const archive = await app.request('/api/projects/group-1/archive', { method: 'POST' });
    const unarchive = await app.request('/api/projects/group-1/unarchive', { method: 'POST' });

    expect(archive.status).toBe(200);
    expect(unarchive.status).toBe(200);
    expect(pipeline.archiveGroup).toHaveBeenCalledWith('group-1');
    expect(pipeline.unarchiveGroup).toHaveBeenCalledWith('group-1');
    expect(pipeline.archive).not.toHaveBeenCalled();
    expect(pipeline.unarchive).not.toHaveBeenCalled();
  });

  it('allows group archive to finish a partially archived group', async () => {
    const archivedAt = '2026-02-01T00:00:00.000Z';
    const project = makeProjectRow({ archived_at: archivedAt });
    const primary = makeServiceRow({ archived_at: archivedAt });
    const worker = makeServiceRow({
      id: 'worker__svc',
      name: 'worker__svc',
      archived_at: null,
      status: 'running',
    });
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => primary),
      getDeployablesByGroup: vi.fn(async () => [primary, worker]),
      isCircuitBreakerOpen: vi.fn(async () => false),
    };
    const pipeline = { archiveGroup: vi.fn(async () => undefined) };
    const coordinator = { suppressProject: vi.fn() };
    const app = createApp({ db, pipeline, coordinator });

    const res = await app.request('/api/projects/group-1/archive', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(pipeline.archiveGroup).toHaveBeenCalledWith('group-1');
  });

  it('blocks project delete when deployable services still exist', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      isCircuitBreakerOpen: vi.fn(async () => false),
    };
    const pipeline = { remove: vi.fn(async () => undefined) };
    const coordinator = { suppressProject: vi.fn() };
    const app = createApp({ db, pipeline, coordinator, cloudflare: {} });

    const res = await app.request('/api/projects/group-1', { method: 'DELETE' });

    expect(res.status).toBe(409);
    expect(pipeline.remove).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      code: 'PROJECT_HAS_ACTIVE_SERVICES',
      details: {
        blockers: [
          {
            serviceId: service.id,
            serviceName: 'group-1',
            slug: 'workspace/group-1',
          },
        ],
      },
    });
  });
});
