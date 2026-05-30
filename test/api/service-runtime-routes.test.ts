import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createServiceRuntimeRoutes } from '../../src/web/api/service-runtime-routes.js';

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
    id: 'api__svc',
    project_id: 'group-1',
    name: 'api__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: 'container-1',
    container_name: 'ol-api',
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

function makeEnvironmentRow(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-1',
    service_id: 'api__svc',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: 10001,
    container_id: 'container-1',
    image_tag: null,
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
  app.route('/api', createServiceRuntimeRoutes(ctx as AppContext));
  return app;
}

function makeRuntimeContext(
  overrides: Partial<AppContext> = {},
  options: {
    group?: ProjectRow;
    runtime?: ProjectRow;
    service?: ServiceRow;
  } = {},
) {
  const group = options.group ?? makeProjectRow({ id: 'group-1', name: 'workspace' });
  const runtime = options.runtime ?? makeProjectRow({ id: 'api', name: 'api' });
  const service =
    options.service ?? makeServiceRow({ id: 'api__svc', project_id: group.id, name: 'api__svc' });
  const db = {
    getProject: vi.fn(async (id: string) =>
      id === group.id ? group : id === runtime.id ? runtime : undefined,
    ),
    getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
    getDeployableForProject: vi.fn(async (id: string) => (id === runtime.id ? service : undefined)),
    isCircuitBreakerOpen: vi.fn(async () => false),
    updateProject: vi.fn(async () => undefined),
    getEnvironmentsByProject: vi.fn(async () => [makeEnvironmentRow()]),
  };
  const pipeline = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    redeploy: vi.fn(async () => ({ success: true, projectId: runtime.id })),
    getBlueGreenEligibility: vi.fn(async () => ({
      supported: true,
      code: 'BLUE_GREEN_UNSUPPORTED',
      reasons: [],
      fallback_strategy: 'force',
    })),
    rollback: vi.fn(async () => ({ success: true, projectId: runtime.id })),
    archive: vi.fn(async () => undefined),
    unarchive: vi.fn(async () => undefined),
  };
  const coordinator = { suppressProject: vi.fn() };
  const ctx = {
    db,
    pipeline,
    coordinator,
    env: { set: vi.fn(async () => undefined) },
    ...overrides,
  } as unknown as AppContext;
  return { app: createApp(ctx), db, pipeline, coordinator, group, runtime, service };
}

function makeDeleteRuntimeContext(
  overrides: {
    service?: ServiceRow;
    siblings?: ServiceRow[];
    agentPool?: unknown;
    docker?: Record<string, unknown>;
  } = {},
) {
  const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
  const runtime = makeProjectRow({ id: 'api', name: 'api' });
  const service =
    overrides.service ??
    makeServiceRow({
      id: 'api__svc',
      project_id: group.id,
      name: 'api__svc',
      container_id: null,
      container_name: null,
    });
  const siblings = overrides.siblings ?? [service];
  const db = {
    getProject: vi.fn(async (id: string) =>
      id === group.id ? group : id === runtime.id ? runtime : undefined,
    ),
    getProjectByName: vi.fn(async (name: string) => (name === group.name ? group : undefined)),
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
    listServiceConsumersForProvider: vi.fn(async () => []),
    findProjectDependents: vi.fn(async () => []),
    getDomainMappingsForService: vi.fn(async () => []),
    deleteDomainMappingsByService: vi.fn(async () => undefined),
    getDeployablesByGroup: vi.fn(async (projectId: string) =>
      projectId === group.id ? siblings : [],
    ),
    deleteProjectDependenciesByService: vi.fn(async () => undefined),
    deleteService: vi.fn(async () => undefined),
    deleteProject: vi.fn(async () => undefined),
  };
  const docker = {
    stopContainer: vi.fn(async () => undefined),
    removeContainer: vi.fn(async () => undefined),
    listVolumes: vi.fn(async () => []),
    removeVolume: vi.fn(async () => undefined),
    ...overrides.docker,
  };
  const cloudflare = {
    removeTunnelForService: vi.fn(async () => undefined),
  };
  const coordinator = { suppressProject: vi.fn() };
  const app = createApp({
    db,
    docker,
    cloudflare,
    coordinator,
    agentPool: overrides.agentPool ?? null,
  });
  return { app, db, docker, coordinator, group, runtime, service };
}

describe('createServiceRuntimeRoutes', () => {
  it('starts the selected service runtime project', async () => {
    const { app, pipeline, runtime } = makeRuntimeContext();

    const res = await app.request('/api/projects/group-1/services/api__svc/start', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(pipeline.start).toHaveBeenCalledWith(runtime.id);
    await expect(res.json()).resolves.toMatchObject({ status: 'started', service: 'api__svc' });
  });

  it('rejects start when the selected service has no container reference', async () => {
    const group = makeProjectRow({ id: 'group-1', name: 'workspace' });
    const runtime = makeProjectRow({ id: 'api', name: 'api', container_id: null });
    const service = makeServiceRow({ id: 'api__svc', project_id: group.id, container_id: null });
    const pipeline = { start: vi.fn(async () => undefined) };
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) =>
          id === group.id ? group : id === runtime.id ? runtime : undefined,
        ),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getDeployableForProject: vi.fn(async (id: string) =>
          id === runtime.id ? service : undefined,
        ),
        isCircuitBreakerOpen: vi.fn(async () => false),
      },
      pipeline,
    });

    const res = await app.request('/api/projects/group-1/services/api__svc/start', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    expect(pipeline.start).not.toHaveBeenCalled();
  });

  it('stops and restarts through the selected runtime project with suppression', async () => {
    const { app, pipeline, coordinator, runtime } = makeRuntimeContext();

    const stop = await app.request('/api/projects/group-1/services/api__svc/stop', {
      method: 'POST',
    });
    const restart = await app.request('/api/projects/group-1/services/api__svc/restart', {
      method: 'POST',
    });

    expect(stop.status).toBe(200);
    expect(restart.status).toBe(200);
    expect(coordinator.suppressProject).toHaveBeenCalledWith(runtime.id, 60_000);
    expect(coordinator.suppressProject).toHaveBeenCalledWith(runtime.id, 30_000);
    expect(pipeline.stop).toHaveBeenCalledWith(runtime.id);
    expect(pipeline.start).toHaveBeenCalledWith(runtime.id);
  });

  it('deploys the selected service runtime project', async () => {
    const { app, db, pipeline, runtime, service } = makeRuntimeContext();

    const res = await app.request('/api/projects/group-1/services/api__svc/deploy?strategy=force', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env_vars: { NODE_ENV: 'production' }, no_cache: true }),
    });

    expect(res.status).toBe(200);
    expect(db.updateProject).toHaveBeenCalledWith(runtime.id, { status: 'building' });
    expect(pipeline.redeploy).toHaveBeenCalledWith(
      runtime.id,
      expect.objectContaining({ noCache: true, strategy: 'force' }),
    );
    await expect(res.json()).resolves.toMatchObject({
      projectId: 'group-1',
      serviceId: service.id,
    });
  });

  it('rejects deploy when the selected service row is archived', async () => {
    const service = makeServiceRow({
      id: 'api__svc',
      project_id: 'group-1',
      name: 'api__svc',
      archived_at: '2026-02-01T00:00:00.000Z',
      status: 'stopped',
    });
    const { app, pipeline, runtime } = makeRuntimeContext({}, { service });

    const res = await app.request('/api/projects/group-1/services/api__svc/deploy?strategy=force', {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      code: 'PROJECT_ARCHIVED',
      details: { projectId: runtime.id },
    });
  });

  it('rejects image services without image_url before marking the project building', async () => {
    const { app, db, pipeline, service, runtime } = makeRuntimeContext();
    service.kind = 'image';
    service.source = 'image';
    service.repo_url = null;
    service.image_url = null;

    const res = await app.request('/api/projects/group-1/services/api__svc/deploy?strategy=force', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ no_cache: true }),
    });

    expect(res.status).toBe(400);
    expect(db.updateProject).not.toHaveBeenCalledWith(runtime.id, { status: 'building' });
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
    });
  });

  it('rejects local OpenLander image tags before marking the project building', async () => {
    const { app, db, pipeline, service, runtime } = makeRuntimeContext();
    service.kind = 'image';
    service.source = 'image';
    service.repo_url = null;
    service.image_url = 'openlander/home-menu:latest';

    const res = await app.request('/api/projects/group-1/services/api__svc/deploy?strategy=force', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ no_cache: true }),
    });

    expect(res.status).toBe(400);
    expect(db.updateProject).not.toHaveBeenCalledWith(runtime.id, { status: 'building' });
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
    });
  });

  it('does not pre-mark blue-green deploys as building before pipeline validation', async () => {
    const { app, db, pipeline, runtime } = makeRuntimeContext();

    const res = await app.request(
      '/api/projects/group-1/services/api__svc/deploy?strategy=blue-green',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ health_check_path: '/' }),
      },
    );

    expect(res.status).toBe(200);
    expect(db.updateProject).not.toHaveBeenCalledWith(runtime.id, { status: 'building' });
    expect(pipeline.redeploy).toHaveBeenCalledWith(
      runtime.id,
      expect.objectContaining({ strategy: 'blue-green', healthCheckPath: '/' }),
    );
  });

  it('returns blocked for unsupported blue-green deploys without running force fallback', async () => {
    const { app, db, pipeline } = makeRuntimeContext();
    pipeline.getBlueGreenEligibility.mockResolvedValueOnce({
      supported: false,
      code: 'BLUE_GREEN_UNSUPPORTED',
      reasons: ['Compose stacks are not eligible for blue-green deploys in v0.1.3.'],
      fallback_strategy: 'force',
    });

    const res = await app.request(
      '/api/projects/group-1/services/api__svc/deploy?strategy=blue-green',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ health_check_path: '/' }),
      },
    );

    expect(res.status).toBe(409);
    expect(db.updateProject).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      status: 'blocked',
      code: 'BLUE_GREEN_UNSUPPORTED',
      strategy: 'blue-green',
      fallback_strategy: 'force',
    });
  });

  it('rolls back the selected service runtime project', async () => {
    const { app, pipeline, runtime, service } = makeRuntimeContext();

    const res = await app.request('/api/projects/group-1/services/api__svc/rollback', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(pipeline.rollback).toHaveBeenCalledWith(
      runtime.id,
      'env-1',
      expect.stringMatching(/^rollback-/),
    );
    await expect(res.json()).resolves.toMatchObject({
      projectId: 'group-1',
      serviceId: service.id,
    });
  });

  it('archives and unarchives the selected service runtime project', async () => {
    const { app, db, pipeline, runtime } = makeRuntimeContext();

    const archive = await app.request('/api/projects/group-1/services/api__svc/archive', {
      method: 'POST',
    });
    const unarchive = await app.request('/api/projects/group-1/services/api__svc/unarchive', {
      method: 'POST',
    });

    expect(archive.status).toBe(200);
    expect(unarchive.status).toBe(200);
    expect(pipeline.archive).toHaveBeenCalledWith(runtime.id);
    expect(pipeline.unarchive).toHaveBeenCalledWith(runtime.id);
    expect(db.getProject).toHaveBeenCalledWith(runtime.id);
  });

  it('rejects service deletion when the runtime project deploy lock is held', async () => {
    const agentPool = {
      acquireProjectLock: vi.fn(() => false),
      getProjectLock: vi.fn(() => ({ sessionId: 'deploy-api' })),
      releaseProjectLock: vi.fn(),
    };
    const { app, db, runtime } = makeDeleteRuntimeContext({ agentPool });

    const res = await app.request('/api/projects/group-1/services/api__svc/instance', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api' }),
    });

    expect(res.status).toBe(409);
    expect(agentPool.acquireProjectLock).toHaveBeenCalledWith(
      runtime.id,
      expect.stringMatching(/^delete-service-api-/),
    );
    expect(agentPool.releaseProjectLock).not.toHaveBeenCalled();
    expect(db.deleteService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      code: 'DEPLOY_LOCKED',
      details: { projectId: runtime.id, lockedBySession: 'deploy-api' },
    });
  });

  it('suppresses recovery for the runtime project while deleting a service', async () => {
    const agentPool = {
      acquireProjectLock: vi.fn(() => true),
      getProjectLock: vi.fn(),
      releaseProjectLock: vi.fn(),
    };
    const { app, db, coordinator, runtime, service } = makeDeleteRuntimeContext({ agentPool });

    const res = await app.request('/api/projects/group-1/services/api__svc/instance', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api' }),
    });

    expect(res.status).toBe(200);
    expect(coordinator.suppressProject).toHaveBeenCalledWith(runtime.id, 60_000);
    expect(agentPool.releaseProjectLock).toHaveBeenCalledWith(
      runtime.id,
      expect.stringMatching(/^delete-service-api-/),
    );
    expect(db.deleteService).toHaveBeenCalledWith(service.id);
    expect(db.deleteProject).toHaveBeenCalledWith(runtime.id);
  });

  it('reports volumes as preserved when sibling deployables force volume deletion to skip', async () => {
    const sibling = makeServiceRow({
      id: 'worker__svc',
      project_id: 'group-1',
      name: 'worker__svc',
      container_id: null,
      container_name: null,
    });
    const { app, docker } = makeDeleteRuntimeContext({ siblings: [makeServiceRow(), sibling] });

    const res = await app.request('/api/projects/group-1/services/api__svc/instance', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmation: 'workspace/api', deleteVolumes: true }),
    });

    expect(res.status).toBe(200);
    expect(docker.listVolumes).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      volumes: {
        deleted: [],
        preserved: true,
        skippedReason: 'PROJECT_HAS_SIBLING_SERVICES',
      },
    });
  });
});
