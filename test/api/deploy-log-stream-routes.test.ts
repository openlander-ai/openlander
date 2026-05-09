import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { DeployLogRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { eventBus } from '../../src/events/index.js';
import { registerDeployLogStreamRoutes } from '../../src/web/api/deploy-log-stream-routes.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-1',
    name: 'demo',
    display_name: 'Demo',
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
    id: 'project-1__svc',
    project_id: 'project-1',
    name: 'project-1__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: 'container-1',
    container_name: 'ol-demo',
    container_port: 3000,
    image_tag: 'openlander/demo:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/openlander/demo',
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

function makeDeployLog(overrides: Partial<DeployLogRow> = {}): DeployLogRow {
  return {
    id: 'deploy-1',
    service_id: 'project-1__svc',
    environment_id: null,
    status: 'success',
    trigger: 'api',
    trigger_detail: null,
    commit_sha: 'abcdef123456',
    commit_message: 'Ship it',
    build_log: '[clone] Cloning\n[pull] Pulling\n#1 [internal] load Dockerfile',
    runtime_log: null,
    duration_ms: 1234,
    created_at: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const api = new Hono();
  registerDeployLogStreamRoutes(api, ctx as AppContext);

  const app = new Hono();
  app.route('/api', api);
  return app;
}

async function waitForListenerCount(event: 'deploy:failed', minimum: number): Promise<void> {
  const startedAt = Date.now();
  while (eventBus.listenerCount(event) < minimum) {
    if (Date.now() - startedAt > 500) {
      throw new Error(`Timed out waiting for ${event} listener`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error('Timed out waiting for stream')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

describe('registerDeployLogStreamRoutes', () => {
  it('replays persisted logs as named SSE line/end events with phase ids', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => makeDeployLog()),
        getService: vi.fn(async () => service),
        getProject: vi.fn(async () => project),
      },
      docker: { cancelBuild: vi.fn(() => false) },
    });

    const res = await app.request('/api/deployments/deploy-1/log/stream');
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('event: line');
    expect(text).toContain('"phase":"clone"');
    expect(text).toContain('"phase":"image_pull"');
    expect(text).toContain('"prefix":"info"');
    expect(text).toContain('event: end');
    expect(text).toContain('"outcome":"success"');
  });

  it('maps live cancelled terminal events to cancelled SSE outcome', async () => {
    const project = makeProjectRow({ id: 'project-live' });
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      },
      docker: { cancelBuild: vi.fn(() => false) },
    });
    const before = eventBus.listenerCount('deploy:failed');

    const res = await app.request('/api/deployments/project-live/log/stream');
    const textPromise = res.text();
    await waitForListenerCount('deploy:failed', before + 1);

    await eventBus.emit('deploy:failed', {
      projectId: 'project-live',
      step: 'cancelled',
      error: 'Build cancelled by user',
      cancelled: true,
    });

    const text = await withTimeout(textPromise);
    expect(text).toContain('event: end');
    expect(text).toContain('"outcome":"cancelled"');
  });

  it('cancels an active project-keyed build', async () => {
    const project = makeProjectRow();
    const cancelBuild = vi.fn(() => true);
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
        getProject: vi.fn(async () => project),
      },
      docker: { cancelBuild },
    });

    const res = await app.request('/api/deployments/project-1/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(cancelBuild).toHaveBeenCalledWith('project-1');
    await expect(res.json()).resolves.toEqual({
      cancelled: true,
      projectId: 'project-1',
      outcome: 'cancelled',
    });
  });

  it('cancels an active service-keyed build through the owning project id', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ id: 'service-1', project_id: project.id });
    const cancelBuild = vi.fn(() => true);
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      },
      docker: { cancelBuild },
    });

    const res = await app.request('/api/deployments/service-1/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(cancelBuild).toHaveBeenCalledWith(project.id);
  });

  it('returns 404 for unresolved cancel ids', async () => {
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
        getProject: vi.fn(async () => undefined),
      },
      docker: { cancelBuild: vi.fn(() => true) },
    });

    const res = await app.request('/api/deployments/missing/cancel', { method: 'POST' });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'NOT_FOUND' });
  });

  it('returns DEPLOYMENT_NOT_ACTIVE for terminal deploy log ids', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => makeDeployLog({ status: 'failed' })),
        getService: vi.fn(async () => service),
        getProject: vi.fn(async () => project),
      },
      docker: { cancelBuild: vi.fn(() => true) },
    });

    const res = await app.request('/api/deployments/deploy-1/cancel', { method: 'POST' });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'DEPLOYMENT_NOT_ACTIVE' });
  });

  it('returns DEPLOYMENT_NOT_ACTIVE when no active build can be cancelled', async () => {
    const project = makeProjectRow();
    const app = createApp({
      db: {
        getDeployLog: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
        getProject: vi.fn(async () => project),
      },
      docker: { cancelBuild: vi.fn(() => false) },
    });

    const res = await app.request('/api/deployments/project-1/cancel', { method: 'POST' });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'DEPLOYMENT_NOT_ACTIVE' });
  });
});
