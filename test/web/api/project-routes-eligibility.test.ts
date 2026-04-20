/**
 * Eligibility guard tests for mutating project routes.
 *
 * Verifies that redeploy, rollback, and blue-green return 409 with the correct
 * error code when the project is archived, recovering, or has an open circuit
 * breaker. Also verifies that a healthy project proceeds normally (regression).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createProjectRoutes } from '../../../src/web/api/project-routes.js';
import type { AppContext } from '../../../src/app.js';
import type { ProjectRow } from '../../../src/db/index.js';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
    name: 'my-app',
    status: 'running',
    source: 'git',
    repo_url: 'https://github.com/test/repo',
    archived_at: null,
    container_id: 'ctr-abc',
    image_tag: 'openlander/my-app:latest',
    previous_image_tag: null,
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

function createCtx(
  project: ProjectRow,
  {
    circuitBreakerOpen = false,
    redeployResult = { success: true },
    rollbackResult = { success: true },
  }: {
    circuitBreakerOpen?: boolean;
    redeployResult?: { success: boolean };
    rollbackResult?: { success: boolean };
  } = {},
): AppContext {
  return {
    config: { language: 'en', git: { sshKeyPath: undefined } },
    db: {
      getProject: vi.fn().mockReturnValue(project),
      getProjectByName: vi.fn().mockReturnValue(undefined),
      updateProject: vi.fn(),
      isCircuitBreakerOpen: vi.fn().mockReturnValue(circuitBreakerOpen),
      getEnvironmentsByProject: vi.fn().mockReturnValue([]),
      getEnvironment: vi.fn().mockReturnValue(undefined),
      getDeployLog: vi.fn().mockReturnValue(undefined),
      getDeployLogsByProject: vi.fn().mockReturnValue([]),
      createDeployLog: vi.fn(),
      updateDeployLog: vi.fn(),
      getProjectLogs: vi.fn().mockReturnValue([]),
    },
    env: { get: vi.fn().mockReturnValue({}), set: vi.fn(), list: vi.fn().mockReturnValue([]) },
    deployQueue: { acquire: vi.fn().mockResolvedValue(vi.fn()) },
    coordinator: { suppressProject: vi.fn() },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue(redeployResult),
      rollback: vi.fn().mockResolvedValue(rollbackResult),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
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

// ---------------------------------------------------------------------------
// Redeploy eligibility
// ---------------------------------------------------------------------------

describe('POST /projects/:id/redeploy - eligibility guard', () => {
  it('returns 409 PROJECT_ARCHIVED when project is archived', async () => {
    const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/redeploy', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_ARCHIVED');
  });

  it('returns 409 CIRCUIT_BREAKER_OPEN when circuit breaker is open', async () => {
    const project = makeProject();
    const app = buildApp(createCtx(project, { circuitBreakerOpen: true }));

    const res = await app.request('/api/projects/proj-1/redeploy', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('CIRCUIT_BREAKER_OPEN');
  });

  it('returns 409 PROJECT_RECOVERING when project is in recovering state', async () => {
    const project = makeProject({ status: 'recovering' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/redeploy', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_RECOVERING');
  });

  it('proceeds normally for a healthy project (regression guard)', async () => {
    const project = makeProject();
    const ctx = createCtx(project, { redeployResult: { success: true } });
    const app = buildApp(ctx);

    const res = await app.request('/api/projects/proj-1/redeploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Healthy project should not get 409
    expect(res.status).not.toBe(409);
    expect([200, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// Rollback eligibility
// ---------------------------------------------------------------------------

describe('POST /projects/:id/rollback - eligibility guard', () => {
  it('returns 409 PROJECT_ARCHIVED when project is archived', async () => {
    const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/rollback', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_ARCHIVED');
  });

  it('returns 409 CIRCUIT_BREAKER_OPEN when circuit breaker is open', async () => {
    const project = makeProject();
    const app = buildApp(createCtx(project, { circuitBreakerOpen: true }));

    const res = await app.request('/api/projects/proj-1/rollback', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('CIRCUIT_BREAKER_OPEN');
  });

  it('returns 409 PROJECT_RECOVERING when project is recovering', async () => {
    const project = makeProject({ status: 'recovering' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/rollback', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_RECOVERING');
  });
});

// ---------------------------------------------------------------------------
// Blue-green eligibility
// ---------------------------------------------------------------------------

describe('POST /projects/:id/blue-green - eligibility guard', () => {
  it('returns 409 PROJECT_ARCHIVED when project is archived', async () => {
    const project = makeProject({ archived_at: '2024-06-01T00:00:00Z' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/blue-green', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_ARCHIVED');
  });

  it('returns 409 CIRCUIT_BREAKER_OPEN when circuit breaker is open', async () => {
    const project = makeProject();
    const app = buildApp(createCtx(project, { circuitBreakerOpen: true }));

    const res = await app.request('/api/projects/proj-1/blue-green', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('CIRCUIT_BREAKER_OPEN');
  });

  it('returns 409 PROJECT_RECOVERING when project is recovering', async () => {
    const project = makeProject({ status: 'recovering' });
    const app = buildApp(createCtx(project));

    const res = await app.request('/api/projects/proj-1/blue-green', { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('PROJECT_RECOVERING');
  });
});
