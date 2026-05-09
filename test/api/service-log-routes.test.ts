import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createServiceLogRoutes } from '../../src/web/api/service-log-routes.js';

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
  app.route('/api', createServiceLogRoutes(ctx as AppContext));
  return app;
}

describe('createServiceLogRoutes', () => {
  it('returns a per-service log snapshot with the requested tail', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const docker = {
      getLogs: vi.fn(async () => 'line one\nline two'),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/logs?lines=25');

    expect(res.status).toBe(200);
    expect(docker.getLogs).toHaveBeenCalledWith('container-1', 25, { timestamps: true });
    await expect(res.json()).resolves.toEqual({
      project: 'workspace',
      service: 'group-1__svc',
      logs: 'line one\nline two',
    });
  });

  it('falls back to 50 lines for invalid line counts', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const docker = {
      getLogs: vi.fn(async () => 'logs'),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/logs?lines=-1');

    expect(res.status).toBe(200);
    expect(docker.getLogs).toHaveBeenCalledWith('container-1', 50, { timestamps: true });
  });

  it('returns empty logs without touching Docker when the service has no container ref', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ container_id: null, container_name: null });
    const docker = {
      getLogs: vi.fn(async () => 'logs'),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/logs');

    expect(res.status).toBe(200);
    expect(docker.getLogs).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({ logs: '' });
  });

  it('returns the legacy project-not-found shape', async () => {
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => makeServiceRow()),
      },
      docker: { getLogs: vi.fn(async () => '') },
    });

    const res = await app.request('/api/projects/missing/services/group-1__svc/logs');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'PROJECT_NOT_FOUND',
      message: 'Project missing not found',
    });
  });

  it('returns the legacy service-not-found shape', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
      },
      docker: { getLogs: vi.fn(async () => '') },
    });

    const res = await app.request('/api/projects/group-1/services/missing/logs');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'SERVICE_NOT_FOUND',
      message: 'Service missing not found',
    });
  });

  it('rejects logs access for a service from another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const docker = {
      getLogs: vi.fn(async () => 'logs'),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/logs');

    expect(res.status).toBe(404);
    expect(docker.getLogs).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: 'SERVICE_NOT_IN_PROJECT',
      message: 'Service group-1__svc does not belong to project group-1',
    });
  });
});
