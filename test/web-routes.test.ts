import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { createApiRoutes } from '../src/web/api/routes.js';
import { ProjectNotFoundError } from '../src/errors.js';

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

function createMockAgent() {
  return {
    chat: vi.fn().mockResolvedValue({ message: 'AI response', toolResults: undefined }),
    chatStream: vi
      .fn()
      .mockImplementation(async (_msg: string, callback: (e: { type: string }) => void) => {
        callback({ type: 'session' });
        callback({ type: 'message', content: 'AI response' });
        callback({ type: 'done' });
      }),
    setTools: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    clearHistory: vi.fn(),
  };
}

function createMockContext(db: Database): AppContext {
  return {
    config: {
      git: { sshKeyPath: '' },
      channels: {
        slack: { enabled: false, token: '', signingSecret: '' },
        discord: { enabled: false, applicationId: '', publicKey: '', token: '' },
        telegram: { enabled: false, token: '', webhookSecret: '' },
      },
      gitProviders: { github: { token: '', username: '' } },
    },
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
    (ctx as Record<string, unknown>).agent = null;

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
