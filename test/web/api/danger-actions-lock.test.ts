/**
 * Per-project lock coverage for danger / lifecycle routes (1.0 GA B1 + B2).
 *
 * Before 1.0 GA only `/redeploy` and `/blue-green` acquired the in-memory
 * `agentPool.acquireProjectLock`. The remaining mutating routes
 * (`/rollback`, `/stop`, `/archive`, DELETE `/projects/:id`, `/purge`)
 * relied on `assertProjectLifecycleMutable` (status field only) +
 * `assertProjectMutable` (route + pipeline boundary) which DO NOT see an
 * in-flight deploy. That left a race window where clicking stop / archive
 * during a deploy produced an inconsistent container state.
 *
 * This spec asserts every B1/B2 wrapped route now:
 *   1. Surfaces a typed `DEPLOY_LOCKED` 409 when a concurrent deploy holds
 *      the lock.
 *   2. Releases the lock cleanly on success so a follow-up call works.
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createProjectGroupRoutes } from '../../../src/web/api/project-group-routes.js';
import { createProjectRoutes } from '../../../src/web/api/project-routes.js';
import type { AppContext } from '../../../src/app.js';
import type { ProjectRow } from '../../../src/db/index.js';
import type { LanguageModel } from 'ai';
import type { Database } from '../../../src/db/index.js';
import { AgentPool } from '../../../src/_ai-ops/agent-pool.js';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-lock',
    name: 'lock-app',
    status: 'running',
    source: 'git',
    repo_url: 'https://github.com/test/lock-app',
    archived_at: null,
    container_id: 'ctr-lock',
    image_tag: 'openlander/lock-app:latest',
    previous_image_tag: 'openlander/lock-app:prev',
    assigned_port: 3001,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    image_url: null,
    image_cmd: null,
    container_port: null,
    visibility: 'internal',
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    branch: 'main',
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ProjectRow;
}

function makeAgentPool(): AgentPool {
  const model = {} as unknown as LanguageModel;
  const db = {} as unknown as Database;
  return new AgentPool(model, db);
}

interface CtxOptions {
  project: ProjectRow;
  agentPool: AgentPool;
  rollbackImpl?: () => Promise<{ success: boolean }>;
  stopImpl?: () => Promise<void>;
  archiveImpl?: () => Promise<void>;
  removeImpl?: () => Promise<void>;
}

function createCtx(opts: CtxOptions): AppContext {
  return {
    config: { language: 'en', git: { sshKeyPath: undefined } },
    db: {
      getProject: vi.fn((id: string) => (id === opts.project.id ? opts.project : undefined)),
      getProjectByName: vi.fn().mockReturnValue(undefined),
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
      updateProject: vi.fn(),
      isCircuitBreakerOpen: vi.fn().mockReturnValue(false),
      getEnvironmentsByProject: vi.fn().mockReturnValue([]),
      getEnvironment: vi.fn().mockReturnValue(undefined),
      updateEnvironment: vi.fn(),
      getDeployLog: vi.fn().mockReturnValue(undefined),
      getDeployLogsByProject: vi.fn().mockReturnValue([]),
      createDeployLog: vi.fn(),
      updateDeployLog: vi.fn(),
      getProjectLogs: vi.fn().mockReturnValue([]),
    },
    env: { get: vi.fn().mockReturnValue({}), set: vi.fn(), list: vi.fn().mockReturnValue([]) },
    deployQueue: { acquire: vi.fn().mockResolvedValue(vi.fn()) },
    coordinator: { suppressProject: vi.fn() },
    agentPool: opts.agentPool,
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockImplementation(opts.rollbackImpl ?? (async () => ({ success: true }))),
      start: vi.fn(),
      stop: vi.fn().mockImplementation(opts.stopImpl ?? (async () => undefined)),
      archive: vi.fn().mockImplementation(opts.archiveImpl ?? (async () => undefined)),
      remove: vi.fn().mockImplementation(opts.removeImpl ?? (async () => undefined)),
    },
    cloudflare: undefined,
    jobManager: { trackJob: vi.fn() },
    questionBridge: { setActiveProject: vi.fn() },
    eventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  } as unknown as AppContext;
}

function buildApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.route('/api', createProjectRoutes(ctx));
  return app;
}

function buildSplitApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.route('/api', createProjectGroupRoutes(ctx));
  app.route('/api', createProjectRoutes(ctx));
  return app;
}

describe('B1 — /rollback acquires per-project lock', () => {
  it('returns 409 DEPLOY_LOCKED when a concurrent rollback holds the lock', async () => {
    const project = makeProject({ id: 'proj-rb-lock', name: 'rb-app' });
    const agentPool = makeAgentPool();
    const ctx = createCtx({
      project,
      agentPool,
      rollbackImpl: () => new Promise((r) => setTimeout(() => r({ success: true }), 200)),
    });
    const app = buildApp(ctx);

    const [first, second] = await Promise.all([
      app.request(`/api/projects/${project.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      app.request(`/api/projects/${project.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const lockedRes = first.status === 409 ? first : second;
    const body = (await lockedRes.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');
  });

  it('releases the rollback lock so a follow-up call succeeds', async () => {
    const project = makeProject({ id: 'proj-rb-release', name: 'rb-release-app' });
    const agentPool = makeAgentPool();
    const ctx = createCtx({ project, agentPool });
    const app = buildApp(ctx);

    const r1 = await app.request(`/api/projects/${project.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(200);

    const r2 = await app.request(`/api/projects/${project.id}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r2.status).toBe(200);
  });
});

describe('B2 — /stop /archive /purge DELETE /projects/:id acquire per-project lock', () => {
  it('/stop is rejected with 409 DEPLOY_LOCKED while a deploy holds the lock', async () => {
    const project = makeProject({ id: 'proj-stop-lock', name: 'stop-app' });
    const agentPool = makeAgentPool();
    // Pre-acquire the lock as if a redeploy is currently in flight.
    expect(agentPool.acquireProjectLock(project.id, 'sim-redeploy-1')).toBe(true);

    const ctx = createCtx({ project, agentPool });
    const app = buildApp(ctx);

    const res = await app.request(`/api/projects/${project.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');
  });

  it('/archive is rejected with 409 DEPLOY_LOCKED while a deploy holds the lock', async () => {
    const project = makeProject({ id: 'proj-archive-lock', name: 'archive-app' });
    const agentPool = makeAgentPool();
    expect(agentPool.acquireProjectLock(project.id, 'sim-redeploy-2')).toBe(true);

    const ctx = createCtx({ project, agentPool });
    const app = buildSplitApp(ctx);

    const res = await app.request(`/api/projects/${project.id}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');
  });

  it('DELETE /projects/:id is rejected with 409 DEPLOY_LOCKED while a deploy holds the lock', async () => {
    const project = makeProject({ id: 'proj-delete-lock', name: 'delete-app' });
    const agentPool = makeAgentPool();
    expect(agentPool.acquireProjectLock(project.id, 'sim-redeploy-3')).toBe(true);

    const ctx = createCtx({ project, agentPool });
    const app = buildSplitApp(ctx);

    const res = await app.request(`/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');
  });

  it('/purge is rejected with 409 DEPLOY_LOCKED while a deploy holds the lock', async () => {
    // Purge requires an archived project.
    const project = makeProject({
      id: 'proj-purge-lock',
      name: 'purge-app',
      archived_at: '2024-01-02T00:00:00Z',
      status: 'stopped',
    });
    const agentPool = makeAgentPool();
    expect(agentPool.acquireProjectLock(project.id, 'sim-redeploy-4')).toBe(true);

    const ctx = createCtx({ project, agentPool });
    const app = buildSplitApp(ctx);

    const res = await app.request(`/api/projects/${project.id}/purge?confirm=true`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');
  });

  it('/stop releases the lock after success so a follow-up /stop succeeds', async () => {
    const project = makeProject({ id: 'proj-stop-release', name: 'stop-release-app' });
    const agentPool = makeAgentPool();
    const ctx = createCtx({ project, agentPool });
    const app = buildApp(ctx);

    const r1 = await app.request(`/api/projects/${project.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(200);

    // Lock must be released.
    expect(agentPool.getProjectLock(project.id)).toBeNull();

    const r2 = await app.request(`/api/projects/${project.id}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r2.status).toBe(200);
  });
});
