/**
 * Concurrent deploy regression test (1.0 GA).
 *
 * Replaces the global `DeployQueue` (which serialized ALL deploys, regardless
 * of project) with `AgentPool.acquireProjectLock` so two different projects
 * can deploy concurrently. Same-project double-deploy is still rejected with
 * a 409 (BUG-002 regression guard).
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import { createProjectRoutes } from '../../../src/web/api/project-routes.js';
import type { AppContext } from '../../../src/app.js';
import type { ProjectRow } from '../../../src/db/index.js';
import type { LanguageModel } from 'ai';
import type { Database } from '../../../src/db/index.js';
import { AgentPool } from '../../../src/_ai-ops/agent-pool.js';

function makeProject(id: string, name: string): ProjectRow {
  return {
    id,
    name,
    status: 'running',
    source: 'git',
    repo_url: `https://github.com/test/${name}`,
    archived_at: null,
    container_id: `ctr-${id}`,
    image_tag: `openlander/${name}:latest`,
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
  } as ProjectRow;
}

function makeAgentPool(): AgentPool {
  const model = {} as unknown as LanguageModel;
  const db = {} as unknown as Database;
  return new AgentPool(model, db);
}

function createCtx(opts: {
  projects: Map<string, ProjectRow>;
  redeployImpl: (projectId: string) => Promise<{ success: boolean }>;
  agentPool: AgentPool;
}): AppContext {
  return {
    config: { language: 'en', git: { sshKeyPath: undefined } },
    db: {
      getProject: vi.fn((id: string) => opts.projects.get(id)),
      getProjectByName: vi.fn().mockReturnValue(undefined),
      updateProject: vi.fn(),
      isCircuitBreakerOpen: vi.fn().mockReturnValue(false),
      getEnvironmentsByProject: vi.fn().mockReturnValue([]),
      getEnvironment: vi.fn().mockReturnValue(undefined),
      getDeployLog: vi.fn().mockReturnValue(undefined),
      getDeployLogsByProject: vi.fn().mockReturnValue([]),
      createDeployLog: vi.fn(),
      updateDeployLog: vi.fn(),
      getProjectLogs: vi.fn().mockReturnValue([]),
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    },
    env: { get: vi.fn().mockReturnValue({}), set: vi.fn(), list: vi.fn().mockReturnValue([]) },
    deployQueue: { acquire: vi.fn().mockResolvedValue(vi.fn()) },
    coordinator: { suppressProject: vi.fn() },
    agentPool: opts.agentPool,
    pipeline: {
      redeploy: vi.fn().mockImplementation((id: string) => opts.redeployImpl(id)),
      rollback: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      archive: vi.fn(),
      remove: vi.fn(),
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

describe('Concurrent deploy — per-project lock (1.0 GA)', () => {
  it('two different projects can redeploy concurrently (no global serialization)', async () => {
    const pa = makeProject('proj-A', 'app-a');
    const pb = makeProject('proj-B', 'app-b');
    const projects = new Map<string, ProjectRow>([
      [pa.id, pa],
      [pb.id, pb],
    ]);
    const agentPool = makeAgentPool();

    const startTimes = new Map<string, number>();
    const endTimes = new Map<string, number>();

    const redeployImpl = (projectId: string): Promise<{ success: boolean }> => {
      startTimes.set(projectId, Date.now());
      return new Promise((resolve) => {
        setTimeout(() => {
          endTimes.set(projectId, Date.now());
          resolve({ success: true });
        }, 200);
      });
    };

    const ctx = createCtx({ projects, redeployImpl, agentPool });
    const app = buildApp(ctx);

    const overallStart = Date.now();
    const [resA, resB] = await Promise.all([
      app.request('/api/projects/proj-A/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      app.request('/api/projects/proj-B/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ]);
    const overallElapsed = Date.now() - overallStart;

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // If the routes serialize globally, the total time would be > 400ms
    // (200ms each, sequential). Per-project locking should let them overlap
    // so the cumulative wall time is closer to 200ms than to 400ms.
    expect(overallElapsed).toBeLessThan(380);

    // Sanity: both projects' redeploy ran (overlapping windows).
    const aStart = startTimes.get('proj-A');
    const bStart = startTimes.get('proj-B');
    const aEnd = endTimes.get('proj-A');
    const bEnd = endTimes.get('proj-B');
    expect(aStart).toBeDefined();
    expect(bStart).toBeDefined();
    expect(aEnd).toBeDefined();
    expect(bEnd).toBeDefined();
    // Overlap = each project started before the other finished.
    expect(aStart!).toBeLessThan(bEnd!);
    expect(bStart!).toBeLessThan(aEnd!);
  });

  it('same project double-redeploy returns 409 on the second request (BUG-002 regression guard)', async () => {
    const pa = makeProject('proj-A', 'app-a');
    const projects = new Map<string, ProjectRow>([[pa.id, pa]]);
    const agentPool = makeAgentPool();

    let inFlight = 0;
    const redeployImpl = (): Promise<{ success: boolean }> => {
      inFlight += 1;
      return new Promise((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve({ success: true });
        }, 200);
      });
    };

    const ctx = createCtx({ projects, redeployImpl, agentPool });
    const app = buildApp(ctx);

    const [resFirst, resSecond] = await Promise.all([
      app.request('/api/projects/proj-A/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      app.request('/api/projects/proj-A/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ]);

    // One must succeed, one must be locked out (409).
    const statuses = [resFirst.status, resSecond.status].sort();
    expect(statuses).toEqual([200, 409]);

    const lockedRes = resFirst.status === 409 ? resFirst : resSecond;
    const body = (await lockedRes.json()) as { error: string };
    expect(body.error).toBe('DEPLOY_LOCKED');

    // No deploys are still in-flight after both requests resolve.
    expect(inFlight).toBe(0);
  });

  it('lock is released after redeploy completes so a follow-up redeploy succeeds', async () => {
    const pa = makeProject('proj-A', 'app-a');
    const projects = new Map<string, ProjectRow>([[pa.id, pa]]);
    const agentPool = makeAgentPool();

    const redeployImpl = (): Promise<{ success: boolean }> => Promise.resolve({ success: true });
    const ctx = createCtx({ projects, redeployImpl, agentPool });
    const app = buildApp(ctx);

    const res1 = await app.request('/api/projects/proj-A/redeploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res1.status).toBe(200);

    // Lock should be released — a follow-up call should not 409.
    const res2 = await app.request('/api/projects/proj-A/redeploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res2.status).toBe(200);
  });
});
