import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createServiceEnvRoutes } from '../../src/web/api/service-env-routes.js';

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

function makeEnvironmentRow(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-development',
    service_id: 'group-1__svc',
    project_id: 'group-1',
    type: 'development',
    branch: 'develop',
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
  app.route('/api', createServiceEnvRoutes(ctx as AppContext));
  return app;
}

describe('createServiceEnvRoutes', () => {
  it('lists env vars for the selected service', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      getAllForService: vi.fn(async () => [{ key: 'DATABASE_URL', value: 'postgres://db' }]),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env');

    expect(res.status).toBe(200);
    expect(env.getAllForService).toHaveBeenCalledWith('group-1', 'group-1__svc');
    await expect(res.json()).resolves.toMatchObject({
      project: 'workspace',
      service: 'group-1__svc',
      envVars: [{ key: 'DATABASE_URL', value: 'postgres://db' }],
    });
  });

  it('resolves project names and deployable service aliases like the legacy route', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      getAllForService: vi.fn(async () => [{ key: 'NODE_ENV', value: 'production' }]),
    };
    const getProject = vi.fn(async () => undefined);
    const getProjectByName = vi.fn(async (name: string) =>
      name === project.name ? project : undefined,
    );
    const getService = vi.fn(async (id: string) => (id === service.id ? service : undefined));
    const app = createApp({
      db: {
        getProject,
        getProjectByName,
        getService,
      },
      env,
    });

    const res = await app.request('/api/projects/workspace/services/group-1/env');

    expect(res.status).toBe(200);
    expect(getProject).toHaveBeenCalledWith('workspace');
    expect(getProjectByName).toHaveBeenCalledWith('workspace');
    expect(getService).toHaveBeenNthCalledWith(1, 'group-1');
    expect(getService).toHaveBeenNthCalledWith(2, 'group-1__svc');
    expect(env.getAllForService).toHaveBeenCalledWith('group-1', 'group-1__svc');
  });

  it('sets service env vars and reports redeploy need for running services', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'running' });
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { NODE_ENV: 'production' } }),
    });

    expect(res.status).toBe(200);
    expect(env.setBulkForService).toHaveBeenCalledWith('group-1', 'group-1__svc', {
      NODE_ENV: 'production',
    });
    await expect(res.json()).resolves.toMatchObject({
      status: 'updated',
      keys: ['NODE_ENV'],
      needsRedeploy: true,
    });
  });

  it('sets service-environment env vars by environment_key', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'running' });
    const environment = makeEnvironmentRow({ type: 'development' });
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getEnvironmentsByProject: vi.fn(async () => [environment]),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'service_environment',
        environment_key: 'development',
        variables: { NODE_ENV: 'development' },
      }),
    });

    expect(res.status).toBe(200);
    expect(env.setBulkForService).toHaveBeenCalledWith(
      'group-1',
      'group-1__svc',
      { NODE_ENV: 'development' },
      'env-development',
    );
    await expect(res.json()).resolves.toMatchObject({
      status: 'updated',
      scope: 'service_environment',
      environment_key: 'development',
      keys: ['NODE_ENV'],
      needsRedeploy: true,
    });
  });

  it('rejects invalid service environment_key writes before saving', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
        getEnvironmentsByProject: vi.fn(async () => []),
      },
      env,
    });

    const missingKeyRes = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'service_environment',
        variables: { NODE_ENV: 'development' },
      }),
    });
    const invalidKeyRes = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'service_environment',
        environment_key: 'preview',
        variables: { NODE_ENV: 'development' },
      }),
    });
    const missingEnvironmentRes = await app.request(
      '/api/projects/group-1/services/group-1__svc/env',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'service_environment',
          environment_key: 'development',
          variables: { NODE_ENV: 'development' },
        }),
      },
    );

    expect(missingKeyRes.status).toBe(400);
    await expect(missingKeyRes.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
      message: 'environment_key is required for environment-scoped env vars',
    });
    expect(invalidKeyRes.status).toBe(400);
    await expect(invalidKeyRes.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'environment_key must be one of: production, staging, development',
    });
    expect(missingEnvironmentRes.status).toBe(404);
    await expect(missingEnvironmentRes.json()).resolves.toMatchObject({
      error: 'ENVIRONMENT_NOT_FOUND',
      message: 'development environment not found for project',
    });
    expect(env.setBulkForService).not.toHaveBeenCalled();
  });

  it('keeps the legacy unchanged response shape for empty env writes', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'running' });
    const env = {
      setBulkForService: vi.fn(async () => false),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: {} }),
    });

    expect(res.status).toBe(200);
    expect(env.setBulkForService).toHaveBeenCalledWith('group-1', 'group-1__svc', {});
    await expect(res.json()).resolves.toMatchObject({
      status: 'unchanged',
      keys: [],
      needsRedeploy: false,
    });
  });

  it('rejects service env writes without variables', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
      message: 'variables object is required',
    });
  });

  it('rejects service env writes with malformed JSON bodies as missing variables', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json {',
    });

    expect(res.status).toBe(400);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
      message: 'variables object is required',
    });
  });

  it.each([
    ['string', 'NODE_ENV=production'],
    ['null', null],
    ['array', ['NODE_ENV=production']],
  ])('rejects service env writes when variables is a %s', async (_label, variables) => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables }),
    });

    expect(res.status).toBe(400);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables must be an object',
    });
  });

  it.each([
    ['number', 3000],
    ['null', null],
    ['array', ['production']],
    ['object', { nested: 'production' }],
  ])('rejects service env writes when a variable value is a %s', async (_label, value) => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { NODE_ENV: value } }),
    });

    expect(res.status).toBe(400);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables values must be strings',
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  '],
    ['space-containing', 'FOO BAR'],
    ['starts with a digit', '1FOO'],
  ])('rejects service env writes when a variable key is %s', async (_label, key) => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { [key]: 'value' } }),
    });

    expect(res.status).toBe(400);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables keys must match [A-Za-z_][A-Za-z0-9_]*',
    });
  });

  it('deletes one service env var', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'stopped' });
    const env = {
      deleteForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env/NODE_ENV', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(env.deleteForService).toHaveBeenCalledWith('group-1', 'group-1__svc', 'NODE_ENV');
    await expect(res.json()).resolves.toMatchObject({
      status: 'deleted',
      key: 'NODE_ENV',
      needsRedeploy: false,
    });
  });

  it('returns not_found when deleting a missing service env var', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'running' });
    const env = {
      deleteForService: vi.fn(async () => false),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env/MISSING_KEY', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(env.deleteForService).toHaveBeenCalledWith('group-1', 'group-1__svc', 'MISSING_KEY');
    await expect(res.json()).resolves.toMatchObject({
      status: 'not_found',
      key: 'MISSING_KEY',
      needsRedeploy: false,
    });
  });

  it.each([
    ['whitespace', '%20'],
    ['space-containing', 'FOO%20BAR'],
    ['starts with a digit', '1FOO'],
  ])('rejects service env deletes when the key is %s', async (_label, keyPath) => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'running' });
    const env = {
      deleteForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request(`/api/projects/group-1/services/group-1__svc/env/${keyPath}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    expect(env.deleteForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'env key must match [A-Za-z_][A-Za-z0-9_]*',
    });
  });

  it('does not allow env access for a service from another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const env = {
      getAllForService: vi.fn(async () => []),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
      env,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/env');

    expect(res.status).toBe(404);
    expect(env.getAllForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });

  it('returns not found for env reads when the project cannot be resolved', async () => {
    const env = {
      getAllForService: vi.fn(async () => []),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => makeServiceRow()),
      },
      env,
    });

    const res = await app.request('/api/projects/missing/services/group-1__svc/env');

    expect(res.status).toBe(404);
    expect(env.getAllForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Project not found: missing',
    });
  });

  it('returns not found for env writes when the project cannot be resolved', async () => {
    const env = {
      setBulkForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => makeServiceRow()),
      },
      env,
    });

    const res = await app.request('/api/projects/missing/services/group-1__svc/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { NODE_ENV: 'production' } }),
    });

    expect(res.status).toBe(404);
    expect(env.setBulkForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Project not found: missing',
    });
  });

  it('returns not found for env deletes when the project cannot be resolved', async () => {
    const env = {
      deleteForService: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => makeServiceRow()),
      },
      env,
    });

    const res = await app.request('/api/projects/missing/services/group-1__svc/env/NODE_ENV', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
    expect(env.deleteForService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Project not found: missing',
    });
  });
});
