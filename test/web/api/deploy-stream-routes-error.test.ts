/**
 * Unit tests for deploy-stream-routes IIFE error handling.
 *
 * Verifies that:
 * 1. The 200 response includes statusUrl so clients can poll for deploy status.
 * 2. The response shape includes the required fields (projectId, projectName, status, statusUrl).
 *
 * The deploy route fires an async IIFE after returning 200. The client must
 * poll statusUrl to discover whether the deploy succeeded or failed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Mock preflight before importing the route so it doesn't need Docker/DB
vi.mock('../../../src/pipeline/preflight.js', () => ({
  preflightCheckOrThrow: vi.fn().mockResolvedValue(undefined),
}));

import { createDeployStreamRoutes } from '../../../src/web/api/deploy-stream-routes.js';
import type { AppContext } from '../../../src/app.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMinimalCtx(): AppContext {
  const projectId = 'proj-test-123';
  const existingProject = {
    id: projectId,
    name: 'my-app',
    status: 'stopped',
    source: 'git',
    repo_url: 'https://github.com/test/repo',
    archived_at: null,
    container_id: null,
    image_tag: null,
    assigned_port: null,
  };

  return {
    // Presence of ctx.agent triggers the async IIFE deploy path
    agent: { run: vi.fn().mockResolvedValue(undefined) },
    config: {
      language: 'en',
      git: { sshKeyPath: undefined },
    },
    db: {
      getProject: vi.fn().mockReturnValue(existingProject),
      getProjectByName: vi.fn().mockReturnValue(existingProject),
      updateProject: vi.fn(),
      createProject: vi.fn().mockReturnValue(existingProject),
      isCircuitBreakerOpen: vi.fn().mockReturnValue(false),
    },
    env: {
      get: vi.fn().mockReturnValue({}),
      set: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(vi.fn()), // release fn
    },
    jobManager: { trackJob: vi.fn() },
    questionBridge: { setActiveProject: vi.fn() },
    coordinator: { suppressProject: vi.fn() },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
    },
    planEngine: {
      createPlan: vi.fn().mockResolvedValue({ plan_id: 'plan-1' }),
      executePlan: vi.fn().mockResolvedValue({ status: 'succeeded' }),
    },
    buildDebugger: null,
    eventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  } as unknown as AppContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /projects/deploy - response includes statusUrl', () => {
  let ctx: AppContext;
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMinimalCtx();
    app = new Hono();
    app.route('/api', createDeployStreamRoutes(ctx));
  });

  it('200 response contains statusUrl pointing to the project resource', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/test/repo',
        name: 'my-app',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty('statusUrl');
    expect(typeof body.statusUrl).toBe('string');
    expect(body.statusUrl).toMatch(/^\/api\/projects\/.+/);
  });

  it('200 response contains projectId, projectName, status=building, and statusUrl', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/test/repo',
        name: 'my-app',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.success).toBe(true);
    expect(typeof body.projectId).toBe('string');
    expect(typeof body.projectName).toBe('string');
    expect(body.status).toBe('building');
    // statusUrl must exactly reference the projectId returned
    expect(body.statusUrl).toBe(`/api/projects/${String(body.projectId)}`);
  });
});
