import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { createApiRoutes } from '../src/web/api/routes.js';

// Mock preflight check to always pass in tests
vi.mock('../src/pipeline/preflight.js', () => ({
  preflightCheckOrThrow: vi.fn().mockResolvedValue({
    pass: true,
    checks: {
      portAvailable: { pass: true, detail: 'OK' },
      nameAvailable: { pass: true, detail: 'OK' },
      resourceOk: { pass: true, detail: 'OK' },
      proxyReady: { pass: true, detail: 'OK' },
    },
    warnings: [],
  }),
  PreflightCheckError: class PreflightCheckError extends Error {
    result: unknown;
    constructor(result: unknown) {
      super('Preflight check failed');
      this.result = result;
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockDocker() {
  return {
    getClient: vi.fn(() => ({
      listContainers: vi.fn().mockResolvedValue([]),
      getContainer: vi.fn().mockReturnValue({
        stats: vi.fn().mockResolvedValue({
          cpu_stats: {
            cpu_usage: { total_usage: 100, percpu_usage: [100] },
            system_cpu_usage: 1000,
          },
          precpu_stats: { cpu_usage: { total_usage: 0 } },
          memory_stats: { usage: 1024 * 1024 * 100, limit: 1024 * 1024 * 1024 },
        }),
        start: vi.fn(),
        logs: vi.fn().mockReturnValue({
          on: vi.fn(),
        }),
      }),
    })),
  };
}

function createMockPipeline() {
  return {
    deploy: vi
      .fn()
      .mockResolvedValue({ success: true, projectId: 'p1', url: 'http://localhost:10001' }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    redeploy: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue('log output'),
    exposeTunnel: vi.fn().mockResolvedValue('https://abc.trycloudflare.com'),
    closeTunnel: vi.fn(),
    rollback: vi.fn().mockResolvedValue({ success: true }),
  };
}

function createMockEnvManager() {
  return {
    getAllMasked: vi.fn().mockReturnValue({ API_KEY: 'sk-***' }),
    setBulk: vi.fn().mockReturnValue(true),
  };
}

function createMockQuestionBridge() {
  return {
    setActiveProject: vi.fn(),
    ask: vi.fn(),
    reply: vi.fn(),
    reject: vi.fn(),
    hasPending: vi.fn().mockReturnValue(false),
  };
}

function createMockJobManager() {
  return {
    trackJob: vi.fn(),
    getStatus: vi.fn().mockReturnValue(null),
    updatePhase: vi.fn(),
  };
}

function createMockChannelManager() {
  return {
    register: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn(),
    listConnected: vi.fn().mockReturnValue([]),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHealthMonitor() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function createMockServiceManager() {
  return {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({
      id: 'svc-1',
      name: 'shared-pg',
      type: 'postgresql',
      image: 'postgres:16-alpine',
      status: 'running',
      container_id: 'container-1',
      container_name: 'ol-svc-shared-pg',
      port: 5432,
      env_vars: null,
      credentials: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAgent() {
  return {
    chat: vi.fn().mockResolvedValue({ message: 'AI response', toolResults: undefined }),
    chatStream: vi
      .fn()
      .mockImplementation(
        async (_msg: string, callback: (e: { type: string; content?: string }) => void) => {
          callback({ type: 'session' });
          callback({ type: 'message', content: 'AI response' });
          callback({ type: 'done' });
        },
      ),
    setTools: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    clearHistory: vi.fn(),
  };
}

function createMockContext(db: Database): AppContext {
  return {
    config: {
      git: { sshKeyPath: '', cloneDir: '' },
      channels: {
        slack: { enabled: false, token: '', signingSecret: '' },
        discord: { enabled: false, applicationId: '', publicKey: '', token: '' },
        telegram: { enabled: false, token: '', webhookSecret: '' },
      },
      gitProviders: { github: { token: '', username: '' }, gitlab: { token: '', username: '' } },
    } as unknown as AppContext['config'],
    db,
    docker: createMockDocker() as unknown as AppContext['docker'],
    pipeline: createMockPipeline() as unknown as AppContext['pipeline'],
    composePipeline: {} as unknown as AppContext['composePipeline'],
    traefik: {} as unknown as AppContext['traefik'],
    env: createMockEnvManager() as unknown as AppContext['env'],
    channelManager: createMockChannelManager() as unknown as AppContext['channelManager'],
    healthMonitor: createMockHealthMonitor() as unknown as AppContext['healthMonitor'],
    agent: createMockAgent() as unknown as AppContext['agent'],
    blueGreen: {
      deploy: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as AppContext['blueGreen'],
    dbProvisioner: {
      provision: vi.fn().mockResolvedValue({ host: 'localhost', port: 5432 }),
    } as unknown as AppContext['dbProvisioner'],
    serviceManager: createMockServiceManager() as unknown as AppContext['serviceManager'],
    buildDebugger: null,
    previewDeployer: {
      deploy: vi.fn().mockResolvedValue({ success: true, url: 'http://preview' }),
      list: vi.fn().mockReturnValue([]),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['previewDeployer'],
    jobManager: createMockJobManager() as unknown as AppContext['jobManager'],
    autoDetector: {} as unknown as AppContext['autoDetector'],
    alertMonitor: {
      getActiveAlerts: vi.fn().mockReturnValue([]),
      dismissAlert: vi.fn(),
    } as unknown as AppContext['alertMonitor'],
    questionBridge: createMockQuestionBridge() as unknown as AppContext['questionBridge'],
    webhookManager: {
      triggerWebhook: vi.fn(),
    } as unknown as AppContext['webhookManager'],
    cloudflare: {} as unknown as AppContext['cloudflare'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Web API Routes', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-web-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    ctx = createMockContext(db);
    app = new Hono();
    app.route('/api', createApiRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects
  // ---------------------------------------------------------------------------

  it('GET /api/projects returns empty list initially', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('count', 0);
    expect(body).toHaveProperty('projects');
    expect(body.projects).toHaveLength(0);
  });

  it('GET /api/projects returns projects with correct shape', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/my-app' });

    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.projects[0]).toHaveProperty('id', 'p1');
    expect(body.projects[0]).toHaveProperty('name', 'my-app');
    expect(body.projects[0]).toHaveProperty('status');
    expect(body.projects[0]).toHaveProperty('visibility');
  });

  it('GET /api/projects?status=running filters by status', async () => {
    db.createProject({ id: 'p1', name: 'running-app', repoUrl: 'https://github.com/user/app1' });
    db.createProject({ id: 'p2', name: 'stopped-app', repoUrl: 'https://github.com/user/app2' });
    db.updateProject('p1', { status: 'running' });

    const res = await app.request('/api/projects?status=running');
    const body = await res.json();

    expect(body.count).toBe(1);
    expect(body.projects[0].name).toBe('running-app');
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/deploy
  // ---------------------------------------------------------------------------

  it('POST /api/projects/deploy validates required repo_url', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'MISSING_FIELD');
  });

  it('POST /api/projects/deploy calls pipeline.deploy directly when agent is null (fallback)', async () => {
    // When agent is null, deploy should fall back to direct pipeline call
    ctx.agent = null;

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/my-app',
        branch: 'main',
        name: 'my-app',
      }),
    });

    expect(res.status).toBe(200);
    expect(ctx.pipeline.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
        name: 'my-app',
      }),
    );
  });

  // v0.2.0: Project-first deploy flow tests
  it('POST /api/projects/deploy returns JSON immediately when agent is available (project-first)', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/my-app',
        branch: 'main',
        name: 'my-app',
      }),
    });

    // Response should be immediate JSON, not SSE
    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify response structure
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('projectId');
    expect(body).toHaveProperty('projectName', 'my-app');
    expect(body).toHaveProperty('status', 'building');
    expect(body.projectId).toHaveLength(12);

    // Verify project was created in DB
    const project = db.getProject(body.projectId);
    expect(project).toBeDefined();
    expect(project!.name).toBe('my-app');
    expect(project!.status).toBe('building');

    // Verify questionBridge was set
    expect(ctx.questionBridge.setActiveProject).toHaveBeenCalledWith(body.projectId);
  });

  it('POST /api/projects/deploy runs agent in background after returning JSON', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/test-project',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectId).toBeDefined();

    // Wait a tick for async agent.chatStream to be called
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify agent.chatStream was called (fire-and-forget)
    expect(ctx.agent?.chatStream).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:id
  // ---------------------------------------------------------------------------

  it('GET /api/projects/:id returns single project', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/my-app' });

    const res = await app.request('/api/projects/p1');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe('p1');
    expect(body.name).toBe('my-app');
  });

  it('GET /api/projects/:id returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent');
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty('error', 'PROJECT_NOT_FOUND');
  });

  it('GET /api/projects/:id can be looked up by name', async () => {
    db.createProject({ id: 'p1', name: 'my-unique-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/my-unique-app');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe('my-unique-app');
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/stop
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/stop stops a running project', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/stop', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('stopped');
    expect(ctx.pipeline.stop).toHaveBeenCalledWith('p1');
  });

  it('POST /api/projects/:id/stop returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/stop', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/start
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/start starts a stopped project', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    db.updateProject('p1', { status: 'stopped', containerId: 'container-123' });

    const res = await app.request('/api/projects/p1/start', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('started');
    expect(ctx.pipeline.start).toHaveBeenCalledWith('p1');
  });

  it('POST /api/projects/:id/start returns 200 if already running', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    db.updateProject('p1', { status: 'running', containerId: 'container-123' });

    const res = await app.request('/api/projects/p1/start', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('already_running');
  });

  it('POST /api/projects/:id/start returns 400 if no container', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/start', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('POST /api/projects/:id/start returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/start', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/rollback
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/rollback rolls back to previous image', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/rollback', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(ctx.pipeline.rollback).toHaveBeenCalledWith('p1');
  });

  it('POST /api/projects/:id/rollback returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/rollback', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /api/projects/:id/rollback returns 500 on failure', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    (ctx.pipeline.rollback as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      error: 'No previous image',
    });

    const res = await app.request('/api/projects/p1/rollback', { method: 'POST' });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('No previous image');
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/blue-green
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/blue-green deploys with zero downtime', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/blue-green', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(ctx.blueGreen.deploy).toHaveBeenCalledWith('p1', { healthCheckPath: undefined });
  });

  it('POST /api/projects/:id/blue-green returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/blue-green', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /api/projects/:id/blue-green returns 500 on failure', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    (ctx.blueGreen.deploy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      message: 'Health check failed',
    });

    const res = await app.request('/api/projects/p1/blue-green', { method: 'POST' });
    expect(res.status).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // Webhook settings API
  // ---------------------------------------------------------------------------

  it('GET /api/projects/:id/webhooks returns empty list', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    const res = await app.request('/api/projects/p1/webhooks');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toEqual([]);
  });

  it('POST /api/projects/:id/webhooks creates webhook config', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    const res = await app.request('/api/projects/p1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'github', branch_filter: 'main' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('github');
    expect(body.branchFilter).toBe('main');
    expect(body.enabled).toBe(true);
    expect(body.secret).toBeTruthy();
    expect(body.webhookUrl).toContain('/api/webhooks/p1/github');
  });

  it('POST /api/projects/:id/webhooks rejects invalid source', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    const res = await app.request('/api/projects/p1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/projects/:id/webhooks/:source deletes config', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    await app.request('/api/projects/p1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'github' }),
    });
    const res = await app.request('/api/projects/p1/webhooks/github', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const listRes = await app.request('/api/projects/p1/webhooks');
    const body = await listRes.json();
    expect(body.webhooks).toEqual([]);
  });

  it('GET /api/projects/:id/webhooks returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/webhooks');
    expect(res.status).toBe(404);
  });

  it('GET /api/services returns shared services list', async () => {
    const mockServices = [
      {
        id: 'svc-1',
        name: 'shared-redis',
        type: 'redis',
        image: 'redis:7-alpine',
        status: 'running',
        container_id: 'c1',
        container_name: 'ol-svc-shared-redis',
        port: 6379,
        env_vars: null,
        credentials: '{}',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    (ctx.serviceManager.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockServices);

    const res = await app.request('/api/services');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockServices);
    expect(ctx.serviceManager.list).toHaveBeenCalled();
  });

  it('POST /api/services creates service', async () => {
    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-pg', template: 'postgresql' }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.create).toHaveBeenCalledWith({
      name: 'shared-pg',
      template: 'postgresql',
      image: undefined,
      port: undefined,
      envVars: undefined,
    });
  });

  it('POST /api/services creates custom image service', async () => {
    const customEnv = [{ key: 'DATABASE_URL', value: 'postgres://user:pass@db:5432/app' }];

    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'my-litellm',
        image: 'ghcr.io/berriai/litellm:latest',
        port: 4000,
        env_vars: customEnv,
      }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.create).toHaveBeenCalledWith({
      name: 'my-litellm',
      template: undefined,
      image: 'ghcr.io/berriai/litellm:latest',
      port: 4000,
      envVars: customEnv,
    });
  });

  it('POST /api/services missing template and image returns 400', async () => {
    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-db' }),
    });

    expect(res.status).toBe(400);
    expect(ctx.serviceManager.create).not.toHaveBeenCalled();
  });

  it('POST /api/services custom image without port returns 400', async () => {
    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'shared-litellm', image: 'ghcr.io/berriai/litellm:latest' }),
    });

    expect(res.status).toBe(400);
    expect(ctx.serviceManager.create).not.toHaveBeenCalled();
  });

  it('GET /api/services/templates returns template list', async () => {
    const res = await app.request('/api/services/templates');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'postgresql', image: 'postgres:16-alpine', port: 5432 }),
        expect.objectContaining({ id: 'mysql', image: 'mysql:8', port: 3306 }),
        expect.objectContaining({ id: 'redis', image: 'redis:7-alpine', port: 6379 }),
        expect.objectContaining({ id: 'mongodb', image: 'mongo:7', port: 27017 }),
      ]),
    );
  });

  it('DELETE /api/services/:id removes service', async () => {
    const res = await app.request('/api/services/svc-1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.remove).toHaveBeenCalledWith('svc-1');
  });

  it('POST /api/services/:id/start starts service', async () => {
    const res = await app.request('/api/services/svc-1/start', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.start).toHaveBeenCalledWith('svc-1');
  });

  it('POST /api/services/:id/stop stops service', async () => {
    const res = await app.request('/api/services/svc-1/stop', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.stop).toHaveBeenCalledWith('svc-1');
  });

  // DELETE /api/projects/:id
  // ---------------------------------------------------------------------------

  it('DELETE /api/projects/:id removes a project', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('removed');
    expect(ctx.pipeline.remove).toHaveBeenCalledWith('p1');
  });

  // ---------------------------------------------------------------------------
  // GET /api/system/stats
  // ---------------------------------------------------------------------------

  it('GET /api/system/stats returns stats object', async () => {
    const res = await app.request('/api/system/stats');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('summary');
    expect(body).toHaveProperty('cpu');
    expect(body).toHaveProperty('memory');
    expect(body).toHaveProperty('disk');
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/env
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/env sets environment variables', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { API_KEY: 'secret-key' } }),
    });

    expect(res.status).toBe(200);
    expect(ctx.env.setBulk).toHaveBeenCalledWith('p1', { API_KEY: 'secret-key' });
  });

  it('POST /api/projects/:id/env validates variables field', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:id/env
  // ---------------------------------------------------------------------------

  it('GET /api/projects/:id/env returns masked env vars', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/env');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('envVars');
    expect(ctx.env.getAllMasked).toHaveBeenCalledWith('p1');
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/expose
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/expose creates public tunnel', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    db.updateProject('p1', { status: 'running', assignedPort: 10001 });

    const res = await app.request('/api/projects/p1/expose', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('publicUrl');
    expect(ctx.pipeline.exposeTunnel).toHaveBeenCalledWith('p1', 10001);
  });

  it('POST /api/projects/:id/expose returns 400 if project not running', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    // status = stopped by default, no assigned_port

    const res = await app.request('/api/projects/p1/expose', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/unexpose
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/unexpose closes public tunnel', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1/unexpose', { method: 'POST' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('unexposed');
    expect(ctx.pipeline.closeTunnel).toHaveBeenCalledWith('p1');
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions
  // ---------------------------------------------------------------------------

  it('GET /api/sessions returns sessions list', async () => {
    const res = await app.request('/api/sessions');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('sessions');
  });
});
