import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { OpenLanderError } from '../../src/errors.js';
import { createProjectEnvRoutes } from '../../src/web/api/project-env-routes.js';

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
    status: 'stopped',
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
    id: 'env-1',
    service_id: 'group-1__svc',
    project_id: 'group-1',
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
  const db = {
    resolveAiOpsPendingInputsForProjectKeys: vi.fn(async () => 0),
    resolveAiOpsPendingInputsForServiceKeys: vi.fn(async () => 0),
    ...((ctx.db as Record<string, unknown> | undefined) ?? {}),
  };
  app.onError((err, c) => {
    if (err instanceof OpenLanderError) {
      return c.json(err.toJSON(), err.statusCode as 400);
    }
    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
  });
  app.route('/api', createProjectEnvRoutes({ ...ctx, db } as AppContext));
  return app;
}

describe('createProjectEnvRoutes', () => {
  it('lists project environments with legacy url fields preserved', async () => {
    const project = makeProjectRow();
    const env = makeEnvironmentRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getEnvironmentsByProject: vi.fn(async () => [env]),
      },
    });

    const res = await app.request('/api/projects/group-1/environments');

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      environments: Array<{ id: string; url?: string; urls?: Array<{ url: string }> }>;
    };
    expect(body.environments).toHaveLength(1);
    expect(body.environments[0]).toMatchObject({
      id: 'env-1',
      url: expect.stringMatching(/^http:\/\/workspace\./),
    });
    expect(Array.isArray(body.environments[0]?.urls)).toBe(true);
  });

  it('keeps frozen environment creation and deletion disabled', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
      },
    });

    const createRes = await app.request('/api/projects/group-1/environments', {
      method: 'POST',
    });
    const deleteRes = await app.request('/api/projects/group-1/environments/env-1', {
      method: 'DELETE',
    });

    expect(createRes.status).toBe(410);
    await expect(createRes.json()).resolves.toMatchObject({ error: 'FEATURE_FROZEN' });
    expect(deleteRes.status).toBe(410);
    await expect(deleteRes.json()).resolves.toMatchObject({ error: 'FEATURE_FROZEN' });
  });

  it('returns inherited env vars for a selected legacy environment', async () => {
    const project = makeProjectRow();
    const env = makeEnvironmentRow();
    const envManager = {
      getAllWithInheritance: vi.fn(async () => ({ DATABASE_URL: 'postgres://db' })),
      getInheritanceInfo: vi.fn(() => ({ DATABASE_URL: { source: 'environment' } })),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getEnvironment: vi.fn(async (id: string) => (id === env.id ? env : undefined)),
      },
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/environments/env-1/env');

    expect(res.status).toBe(200);
    expect(envManager.getAllWithInheritance).toHaveBeenCalledWith('group-1', 'env-1');
    expect(envManager.getInheritanceInfo).toHaveBeenCalledWith('group-1', 'env-1');
    await expect(res.json()).resolves.toMatchObject({
      envVars: { DATABASE_URL: 'postgres://db' },
      inheritance: { DATABASE_URL: { source: 'environment' } },
    });
  });

  it('proxies project-level env reads to the single deployable service', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const envManager = {
      getAllForService: vi.fn(async () => ({ NODE_ENV: 'production' })),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [service]),
      },
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/env');

    expect(res.status).toBe(200);
    expect(envManager.getAllForService).toHaveBeenCalledWith('group-1', 'group-1__svc');
    await expect(res.json()).resolves.toMatchObject({
      project: 'workspace',
      service: 'group-1__svc',
      envVars: { NODE_ENV: 'production' },
    });
  });

  it('falls back to project-scoped env reads when a group has no deployable services', async () => {
    const project = makeProjectRow();
    const envManager = {
      getAll: vi.fn(async () => ({ LEGACY_ONLY: 'true' })),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
      },
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/env');

    expect(res.status).toBe(200);
    expect(envManager.getAll).toHaveBeenCalledWith('group-1');
    await expect(res.json()).resolves.toMatchObject({
      project: 'workspace',
      envVars: { LEGACY_ONLY: 'true' },
    });
  });

  it('falls back to project-scoped env writes when a group has no deployable services', async () => {
    const project = makeProjectRow({ status: 'running' });
    const envManager = {
      setBulk: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
      },
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { LEGACY_ONLY: 'true' } }),
    });

    expect(res.status).toBe(200);
    expect(envManager.setBulk).toHaveBeenCalledWith('group-1', { LEGACY_ONLY: 'true' });
    await expect(res.json()).resolves.toMatchObject({
      status: 'updated',
      keys: ['LEGACY_ONLY'],
      needsRedeploy: true,
    });
  });

  it('writes explicit project-shared env vars without using the v0.1 service compat path', async () => {
    const project = makeProjectRow({ status: 'running' });
    const service = makeServiceRow();
    const envManager = {
      setBulk: vi.fn(async () => true),
      setBulkForService: vi.fn(async () => true),
    };
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      resolveAiOpsPendingInputsForProjectKeys: vi.fn(async () => 1),
    };
    const app = createApp({
      db,
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'project', variables: { SHARED_KEY: 'project' } }),
    });

    expect(res.status).toBe(200);
    expect(envManager.setBulk).toHaveBeenCalledWith('group-1', { SHARED_KEY: 'project' });
    expect(envManager.setBulkForService).not.toHaveBeenCalled();
    expect(db.resolveAiOpsPendingInputsForProjectKeys).toHaveBeenCalledWith('group-1', [
      'SHARED_KEY',
    ]);
    await expect(res.json()).resolves.toMatchObject({
      status: 'updated',
      scope: 'project',
      keys: ['SHARED_KEY'],
      needsRedeploy: true,
    });
  });

  it('writes explicit project-environment env vars by environment_key', async () => {
    const project = makeProjectRow();
    const environment = makeEnvironmentRow({
      id: 'env-development',
      type: 'development',
      status: 'running',
    });
    const envManager = {
      setBulk: vi.fn(async () => true),
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getEnvironmentsByProject: vi.fn(async () => [environment]),
      },
      env: envManager,
    });

    const res = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_environment',
        environment_key: 'development',
        variables: { SHARED_KEY: 'development' },
      }),
    });

    expect(res.status).toBe(200);
    expect(envManager.setBulk).toHaveBeenCalledWith(
      'group-1',
      { SHARED_KEY: 'development' },
      'env-development',
    );
    await expect(res.json()).resolves.toMatchObject({
      status: 'updated',
      scope: 'project_environment',
      environment_key: 'development',
      keys: ['SHARED_KEY'],
      needsRedeploy: true,
    });
  });

  it('rejects invalid project environment_key writes before saving', async () => {
    const project = makeProjectRow();
    const setBulk = vi.fn(async () => true);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getEnvironmentsByProject: vi.fn(async () => []),
      },
      env: { setBulk },
    });

    const missingKeyRes = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_environment',
        variables: { SHARED_KEY: 'development' },
      }),
    });
    const invalidKeyRes = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_environment',
        environment_key: 'preview',
        variables: { SHARED_KEY: 'development' },
      }),
    });
    const missingEnvironmentRes = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project_environment',
        environment_key: 'development',
        variables: { SHARED_KEY: 'development' },
      }),
    });

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
    expect(setBulk).not.toHaveBeenCalled();
  });

  it('requires service selection when project-level env reads target multi-deployable groups', async () => {
    const project = makeProjectRow();
    const serviceA = makeServiceRow({ id: 'web__svc', name: 'web__svc', source: 'git' });
    const serviceB = makeServiceRow({ id: 'worker__svc', name: 'worker__svc', source: 'image' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [serviceA, serviceB]),
      },
      env: {
        getAllForService: vi.fn(async () => ({})),
        getAll: vi.fn(async () => ({})),
      },
    });

    const res = await app.request('/api/projects/group-1/env');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'SERVICE_SELECTION_REQUIRED',
      details: {
        candidates: [
          { serviceId: 'web__svc', serviceName: 'web__svc' },
          { serviceId: 'worker__svc', serviceName: 'worker__svc' },
        ],
      },
    });
  });

  it('requires service selection when project-level env writes target multi-deployable groups', async () => {
    const project = makeProjectRow();
    const serviceA = makeServiceRow({ id: 'web__svc', name: 'web__svc', source: 'git' });
    const serviceB = makeServiceRow({ id: 'worker__svc', name: 'worker__svc', source: 'image' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [serviceA, serviceB]),
      },
      env: {
        setBulkForService: vi.fn(async () => true),
        setBulk: vi.fn(async () => true),
      },
    });

    const res = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { NODE_ENV: 'production' } }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'SERVICE_SELECTION_REQUIRED',
      details: {
        projectId: 'group-1',
        projectName: 'workspace',
        candidates: [
          { serviceId: 'web__svc', serviceName: 'web__svc', source: 'git' },
          { serviceId: 'worker__svc', serviceName: 'worker__svc', source: 'image' },
        ],
      },
    });
  });

  it('rejects malformed JSON bodies on project-level env writes with 400', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
      },
      env: {
        setBulk: vi.fn(async () => true),
      },
    });

    const res = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json {',
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
      message: 'variables object is required',
    });
  });

  it('rejects invalid project-level env keys and values before writing', async () => {
    const project = makeProjectRow();
    const setBulk = vi.fn(async () => true);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
      },
      env: { setBulk },
    });

    const invalidKeyRes = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { 'BAD KEY': 'value' } }),
    });
    const invalidValueRes = await app.request('/api/projects/group-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { GOOD_KEY: 123 } }),
    });

    expect(invalidKeyRes.status).toBe(400);
    await expect(invalidKeyRes.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables keys must match [A-Za-z_][A-Za-z0-9_]*',
    });
    expect(invalidValueRes.status).toBe(400);
    await expect(invalidValueRes.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables values must be strings',
    });
    expect(setBulk).not.toHaveBeenCalled();
  });

  it('rejects invalid environment-scoped env payloads before writing', async () => {
    const project = makeProjectRow();
    const env = makeEnvironmentRow();
    const setBulk = vi.fn(async () => true);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getEnvironment: vi.fn(async (id: string) => (id === env.id ? env : undefined)),
      },
      env: { setBulk },
    });

    const malformedJsonRes = await app.request('/api/projects/group-1/environments/env-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json {',
    });
    const invalidKeyRes = await app.request('/api/projects/group-1/environments/env-1/env', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variables: { 'BAD KEY': 'value' } }),
    });

    expect(malformedJsonRes.status).toBe(400);
    await expect(malformedJsonRes.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
    });
    expect(invalidKeyRes.status).toBe(400);
    await expect(invalidKeyRes.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'variables keys must match [A-Za-z_][A-Za-z0-9_]*',
    });
    expect(setBulk).not.toHaveBeenCalled();
  });

  it('rejects env-example generation when the canonical deployable has no repo source', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ repo_url: null });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getServices: vi.fn(async () => [service]),
        getDeployableForProject: vi.fn(async () => {
          throw new Error('getDeployableForProject must not be called by env-example');
        }),
      },
    });

    const res = await app.request('/api/projects/group-1/env-example');

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'SERVICE_SOURCE_MISSING',
      code: 'SERVICE_SOURCE_MISSING',
    });
  });
});
