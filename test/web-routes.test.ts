import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { eventBus } from '../src/events/index.js';
import { createApiRoutes } from '../src/web/api/routes.js';
import { createMockContext } from './helpers/web-route-mocks.js';
import * as statsModule from '../src/monitor/stats.js';
// Mock preflight check to always pass in tests
vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/fake-clone' }),
}));
vi.mock('../src/pipeline/env-scan.js', () => ({
  scanForEnvUsage: vi.fn().mockReturnValue({
    vars: [{ key: 'DATABASE_URL', files: [{ path: 'app.ts', line: 1 }] }],
    hasEnvExample: false,
    language: 'node',
    serviceHints: [],
  }),
  scanRepoEnvVars: vi.fn().mockReturnValue({
    vars: [],
    hasEnvExample: false,
    language: 'unknown',
    serviceHints: [],
  }),
}));
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
    vi.spyOn(statsModule, 'getSystemStats').mockReturnValue({
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 1,
        loadAvg5m: 1,
        loadAvg15m: 1,
        usagePercent: 25,
      },
      memory: { totalMB: 16000, usedMB: 8000, freeMB: 8000, usagePercent: 50 },
      disk: { totalGB: 100, usedGB: 40, freeGB: 60, usagePercent: 40 },
    });
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

  it('GET /api/projects normalizes project timestamps to ISO UTC', async () => {
    db.createProject({ id: 'p1', name: 'time-app', repoUrl: 'https://github.com/user/time-app' });

    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.projects[0].createdAt).toMatch(/T/);
    expect(body.projects[0].createdAt).toMatch(/Z$/);
    expect(body.projects[0].updatedAt).toMatch(/T/);
    expect(body.projects[0].updatedAt).toMatch(/Z$/);
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

  it('GET /api/projects/:id/deployments includes normalized timestamps and failure summary', async () => {
    db.createProject({
      id: 'p1',
      name: 'deploy-app',
      repoUrl: 'https://github.com/user/deploy-app',
    });
    db.createDeployLog({
      id: 'd1',
      projectId: 'p1',
      status: 'failed',
      trigger: 'chat',
      commitSha: 'abcdef1234567890',
      durationMs: 42000,
      buildLog: 'step 1\n[error] Docker build failed for test-image',
    });

    const res = await app.request('/api/projects/p1/deployments');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deployments[0].createdAt).toMatch(/T/);
    expect(body.deployments[0].createdAt).toMatch(/Z$/);
    expect(body.deployments[0].failureSummary).toContain('Docker build failed');
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

  it('POST /api/projects/deploy runs deploy plan create/execute in background', async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/user/test-project',
        trigger: 'api',
      }),
    );
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
    expect(ctx.agent?.chatStream).not.toHaveBeenCalled();
  });

  it('POST /api/projects/deploy ignores agent orchestration and uses plan engine', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/no-agent-orchestration-app',
      }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.agent?.chatStream).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
  });

  it('POST /api/projects/deploy emits deterministic terminal messages via agent:event stream', async () => {
    const capturedAgentEvents: Array<{ projectId: string; type: string }> = [];
    const unsubscribe = eventBus.on('agent:event', (payload) => {
      capturedAgentEvents.push({ projectId: payload.projectId, type: payload.event.type });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/deterministic-message-app',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    const messageEvents = capturedAgentEvents.filter(
      (event) => event.projectId === body.projectId && event.type === 'message',
    );

    expect(messageEvents.length).toBeGreaterThan(0);
    expect(ctx.agent?.chatStream).not.toHaveBeenCalled();
  });

  it('POST /api/projects/deploy delegates monorepo selection to plan engine', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/monorepo-select',
      }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
  });

  it('POST /api/projects/deploy delegates compose fallback handling to plan engine', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/compose-monorepo-fallback' }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
  });

  it('POST /api/projects/deploy keeps web flow thin for compose/single decisions', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/compose-single-fallback' }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
  });

  it('POST /api/projects/deploy runs AI terminal analysis and retries when user selects retry', async () => {
    (
      ctx.planEngine.createPlan as unknown as { mockRejectedValueOnce: (value: unknown) => void }
    ).mockRejectedValueOnce(new Error('docker build failed at step 8'));

    const diagnose = vi.fn().mockResolvedValue({
      summary: 'Missing package manager lockfile',
      rootCause: 'The build expects a lockfile that is not committed.',
      suggestedFixes: [
        {
          description: 'Commit package-lock.json and retry the build.',
          location: 'repo root',
          confidence: 'high' as const,
        },
      ],
      rawAnalysis: 'raw',
    });
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];

    (
      ctx.questionBridge.ask as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce([
      {
        questionIndex: 0,
        selectedLabels: ['Retry deployment now'],
      },
    ]);

    const capturedMessages: string[] = [];
    const unsubscribe = eventBus.on('agent:event', (payload) => {
      if (payload.event.type === 'message') capturedMessages.push(payload.event.content);
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/terminal-ai-retry' }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    unsubscribe();

    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({
        buildLog: 'docker build failed at step 8',
        failedStep: 'orchestrate',
      }),
    );
    expect(ctx.questionBridge.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            header: 'Deployment Recovery',
            options: expect.arrayContaining([
              expect.objectContaining({ label: 'Retry deployment now' }),
              expect.objectContaining({ label: 'Manual follow-up 1' }),
              expect.objectContaining({ label: 'Cancel' }),
            ]),
          }),
        ],
      }),
    );
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(2);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
    expect(capturedMessages.some((message) => message.includes('AI summary:'))).toBe(true);
    expect(capturedMessages.some((message) => message.includes('Root cause:'))).toBe(true);
  });

  it('POST /api/projects/deploy keeps explicit failure when user selects cancel after AI analysis', async () => {
    (
      ctx.planEngine.createPlan as unknown as { mockRejectedValue: (value: unknown) => void }
    ).mockRejectedValue(new Error('container failed before start'));

    const diagnose = vi.fn().mockResolvedValue({
      summary: 'Container start command exited immediately',
      rootCause: 'The runtime command exits with non-zero status.',
      suggestedFixes: [],
      rawAnalysis: 'raw',
    });
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];

    (
      ctx.questionBridge.ask as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce([
      {
        questionIndex: 0,
        selectedLabels: ['Cancel'],
      },
    ]);

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/terminal-ai-cancel' }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    unsubscribe();

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(0);
    expect(failedEvents).toContainEqual({
      step: 'orchestrate',
      error: 'container failed before start',
    });
  });

  it('POST /api/projects/deploy emits manual follow-up when user selects AI suggested fix option', async () => {
    (
      ctx.planEngine.createPlan as unknown as { mockRejectedValue: (value: unknown) => void }
    ).mockRejectedValue(new Error('npm ci exited with code 1'));

    const diagnose = vi.fn().mockResolvedValue({
      summary: 'Dependency lockfile mismatch',
      rootCause: 'package-lock.json is stale relative to package.json.',
      suggestedFixes: [
        {
          description: 'Regenerate package-lock.json and commit it before redeploying.',
          location: 'repo root',
          confidence: 'high' as const,
        },
      ],
      rawAnalysis: 'raw',
    });
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];

    (
      ctx.questionBridge.ask as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce([
      {
        questionIndex: 0,
        selectedLabels: ['Manual follow-up 1'],
      },
    ]);

    const userActionEvents: Array<{ category: string; title: string; description: string }> = [];
    const unsubscribe = eventBus.on('deploy:needs-user-action', (payload) => {
      userActionEvents.push({
        category: payload.category,
        title: payload.title,
        description: payload.description,
      });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/user/terminal-ai-manual-fix' }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    unsubscribe();

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(0);
    expect(userActionEvents).toContainEqual({
      category: 'manual_followup_required',
      title: 'Manual fix required',
      description:
        'This suggested fix was not auto-applied: Regenerate package-lock.json and commit it before redeploying.',
    });
  });

  it('POST /api/projects/deploy no longer prompts service selection in web route', async () => {
    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'https://github.com/user/monorepo-dismissed',
      }),
    });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).toHaveBeenCalledTimes(1);
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
  });

  // Phase E_NEW: the project-keyed `/api/projects/:id/build/stream`
  // route was deleted under iteration-5 single-SSE consolidation. The
  // three secret-redaction characterization tests that exercised it
  // were removed alongside; v4 deploys go through
  // `/api/deployments/:id/log/stream` (deploy-log-stream-routes.ts),
  // which never round-trips agent tool_result payloads — only line/end
  // events — so the redaction surface they covered no longer exists.

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
    expect(body.status).toBe('started');
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
    expect(ctx.pipeline.redeploy).toHaveBeenCalledWith('p1', {
      strategy: 'blue-green',
      healthCheckPath: undefined,
    });
  });

  it('POST /api/projects/:id/blue-green returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/blue-green', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /api/projects/:id/blue-green returns 500 on failure', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });
    (ctx.pipeline.redeploy as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
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
    (ctx.serviceManager.listWithCardSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockServices,
    );

    const res = await app.request('/api/services');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockServices);
    expect(ctx.serviceManager.listWithCardSummary).toHaveBeenCalled();
  });

  it('GET /api/services/:id returns service detail', async () => {
    const res = await app.request('/api/services/svc-1');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id', 'svc-1');
    expect(ctx.serviceManager.getDetail).toHaveBeenCalledWith('svc-1');
  });

  it('GET /api/services/:id returns 404 when service does not exist', async () => {
    (ctx.serviceManager.getDetail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service not found: missing-svc'),
    );

    const res = await app.request('/api/services/missing-svc');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'NOT_FOUND', message: 'Service not found: missing-svc' });
  });

  it('GET /api/services/:id/logs returns logs with default lines', async () => {
    const res = await app.request('/api/services/svc-1/logs');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ logs: 'service logs' });
    expect(ctx.serviceManager.getLogs).toHaveBeenCalledWith('svc-1', 100);
  });

  it('GET /api/services/:id/logs accepts lines query', async () => {
    const res = await app.request('/api/services/svc-1/logs?lines=10');

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.getLogs).toHaveBeenCalledWith('svc-1', 10);
  });

  it('GET /api/services/:id/logs validates lines query', async () => {
    const res = await app.request('/api/services/svc-1/logs?lines=abc');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_FIELD');
  });

  it('GET /api/services/:id/stats returns service stats', async () => {
    const res = await app.request('/api/services/svc-1/stats');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'running', diskUsageBytes: 128 });
    expect(ctx.serviceManager.getStats).toHaveBeenCalledWith('svc-1');
  });

  it('GET /api/services/:id/stats returns 404 when service does not exist', async () => {
    (ctx.serviceManager.getStats as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service not found: missing-svc'),
    );

    const res = await app.request('/api/services/missing-svc/stats');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'NOT_FOUND', message: 'Service not found: missing-svc' });
  });

  it('GET /api/services/:id/databases returns service databases', async () => {
    const res = await app.request('/api/services/svc-1/databases');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      databases: [
        { name: 'openlander', sizeBytes: 1024 },
        { name: 'postgres', sizeBytes: 2048 },
      ],
    });
    expect(ctx.serviceManager.listDatabases).toHaveBeenCalledWith('svc-1');
  });

  it('GET /api/services/:id/databases returns 404 when service does not exist', async () => {
    (ctx.serviceManager.listDatabases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service not found: missing-svc'),
    );

    const res = await app.request('/api/services/missing-svc/databases');

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'NOT_FOUND', message: 'Service not found: missing-svc' });
  });

  it('GET /api/services/:id/databases returns 400 for unsupported service type', async () => {
    (ctx.serviceManager.listDatabases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Database listing is not supported for redis services'),
    );

    const res = await app.request('/api/services/svc-redis/databases');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('UNSUPPORTED_SERVICE_TYPE');
  });

  it('POST /api/services/:id/databases creates database', async () => {
    const res = await app.request('/api/services/svc-1/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'appdb' }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.createDatabase).toHaveBeenCalledWith('svc-1', 'appdb');
  });

  it('POST /api/services/:id/databases validates required name field', async () => {
    const res = await app.request('/api/services/svc-1/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(ctx.serviceManager.createDatabase).not.toHaveBeenCalled();
  });

  it('GET /api/services/:id/databases returns 400 SERVICE_STOPPED when container is not running', async () => {
    (ctx.serviceManager.listDatabases as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service container is not running: svc-1'),
    );

    const res = await app.request('/api/services/svc-1/databases');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'SERVICE_STOPPED',
      message: 'Service container is not running: svc-1',
    });
  });

  it('POST /api/services/:id/databases returns 400 SERVICE_STOPPED when container is not running', async () => {
    (ctx.serviceManager.createDatabase as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service container is not running: svc-1'),
    );

    const res = await app.request('/api/services/svc-1/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'appdb' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'SERVICE_STOPPED',
      message: 'Service container is not running: svc-1',
    });
  });

  it('GET /api/services/:id/users returns service users', async () => {
    const res = await app.request('/api/services/svc-1/users');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ users: [{ name: 'openlander' }] });
    expect(ctx.serviceManager.listUsers).toHaveBeenCalledWith('svc-1');
  });

  it('GET /api/services/:id/users returns 400 for unsupported service type', async () => {
    (ctx.serviceManager.listUsers as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('User listing is not supported for redis services'),
    );

    const res = await app.request('/api/services/svc-redis/users');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('UNSUPPORTED_SERVICE_TYPE');
  });

  it('GET /api/services/:id/users returns 400 SERVICE_STOPPED when container is not running', async () => {
    (ctx.serviceManager.listUsers as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service container is not running: svc-1'),
    );

    const res = await app.request('/api/services/svc-1/users');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'SERVICE_STOPPED',
      message: 'Service container is not running: svc-1',
    });
  });

  it('POST /api/services/:id/users creates service user', async () => {
    const res = await app.request('/api/services/svc-1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'app_user', password: 'pw123', database: 'appdb' }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.createUser).toHaveBeenCalledWith('svc-1', 'app_user', 'pw123', {
      database: 'appdb',
    });
  });

  it('POST /api/services/:id/users validates required username field', async () => {
    const res = await app.request('/api/services/svc-1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'pw123' }),
    });

    expect(res.status).toBe(400);
    expect(ctx.serviceManager.createUser).not.toHaveBeenCalled();
  });

  it('POST /api/services/:id/users returns 404 when service does not exist', async () => {
    (ctx.serviceManager.createUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service not found: missing-svc'),
    );

    const res = await app.request('/api/services/missing-svc/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'app_user' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'NOT_FOUND', message: 'Service not found: missing-svc' });
  });

  it('POST /api/services/:id/users returns 400 SERVICE_STOPPED when container is not running', async () => {
    (ctx.serviceManager.createUser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Service container is not running: svc-1'),
    );

    const res = await app.request('/api/services/svc-1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'app_user' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'SERVICE_STOPPED',
      message: 'Service container is not running: svc-1',
    });
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

  it('GET /api/services/templates includes versions array for each template', async () => {
    const res = await app.request('/api/services/templates');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'postgresql',
          versions: expect.arrayContaining(['17-alpine', '16-alpine', '15-alpine', '14-alpine']),
        }),
        expect.objectContaining({
          id: 'mysql',
          versions: expect.arrayContaining(['9', '8']),
        }),
        expect.objectContaining({
          id: 'redis',
          versions: expect.arrayContaining(['8-alpine', '7-alpine']),
        }),
        expect.objectContaining({
          id: 'mongodb',
          versions: expect.arrayContaining(['8', '7']),
        }),
      ]),
    );
  });

  it('POST /api/services passes version parameter to serviceManager.create', async () => {
    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'shared-pg-15',
        template: 'postgresql',
        version: '15-alpine',
      }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.create).toHaveBeenCalledWith({
      name: 'shared-pg-15',
      template: 'postgresql',
      image: undefined,
      port: undefined,
      version: '15-alpine',
      envVars: undefined,
    });
  });

  it('POST /api/services works without version parameter (backward compatible)', async () => {
    const res = await app.request('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'shared-pg-default',
        template: 'postgresql',
      }),
    });

    expect(res.status).toBe(200);
    expect(ctx.serviceManager.create).toHaveBeenCalledWith({
      name: 'shared-pg-default',
      template: 'postgresql',
      image: undefined,
      port: undefined,
      version: undefined,
      envVars: undefined,
    });
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

  it('DELETE /api/projects/:id archives a project', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/app' });

    const res = await app.request('/api/projects/p1', { method: 'DELETE' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('archived');
    expect(ctx.pipeline.archive).toHaveBeenCalledWith('p1');
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
    expect(ctx.env.getAll).toHaveBeenCalledWith('p1');
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

  it('POST /api/projects/:id/share shares a running project with access code', async () => {
    db.createProject({
      id: 'share-test',
      name: 'share-app',
      repoUrl: 'https://github.com/test/repo',
    });
    db.updateProject('share-test', {
      status: 'running',
      assignedPort: 10001,
      visibility: 'quick-share',
    });

    const res = await app.request('/api/projects/share-test/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: 'test1234' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('shared');

    const project = db.getProject('share-test');
    expect(project?.visibility).toBe('shared');
    expect(project?.access_code).toBeTruthy();
    expect(project?.access_code_iv).toBeTruthy();
  });

  it('POST /api/projects/:id/share rejects access code shorter than 4 characters', async () => {
    db.createProject({
      id: 'short-code',
      name: 'short-app',
      repoUrl: 'https://github.com/test/repo',
    });
    db.updateProject('short-code', { status: 'running', assignedPort: 10002 });

    const res = await app.request('/api/projects/short-code/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: 'ab' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('INVALID_ACCESS_CODE');
  });

  it('POST /api/projects/:id/share rejects sharing a non-running project without port', async () => {
    db.createProject({
      id: 'stopped-share',
      name: 'stopped-app',
      repoUrl: 'https://github.com/test/repo',
    });

    const res = await app.request('/api/projects/stopped-share/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: 'test1234' }),
    });

    expect(res.status).toBe(400);
  });

  it('DELETE /api/projects/:id/share unshares a shared project', async () => {
    db.createProject({
      id: 'unshare-test',
      name: 'unshare-app',
      repoUrl: 'https://github.com/test/repo',
    });
    db.updateProject('unshare-test', {
      visibility: 'shared',
      accessCode: 'enc',
      accessCodeIv: 'iv',
    });

    const res = await app.request('/api/projects/unshare-test/share', { method: 'DELETE' });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('unshared');

    const project = db.getProject('unshare-test');
    expect(project?.visibility).toBe('quick-share');
    expect(project?.access_code).toBeNull();
    expect(project?.access_code_iv).toBeNull();
  });

  it('GET /api/projects/:id/previews returns empty previews list', async () => {
    db.createProject({
      id: 'prev-parent',
      name: 'parent-app',
      repoUrl: 'https://github.com/test/repo',
    });

    const res = await app.request('/api/projects/prev-parent/previews');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.previews).toEqual([]);
  });

  it('GET /api/projects/:id/previews returns preview projects for parent', async () => {
    db.createProject({ id: 'pp', name: 'parent', repoUrl: 'https://github.com/test/repo' });
    db.createProject({ id: 'pr1', name: 'parent-pr-42', repoUrl: 'https://github.com/test/repo' });
    db.updateProject('pr1', { parentProjectId: 'pp', isPreview: 1, prNumber: 42 });

    const res = await app.request('/api/projects/pp/previews');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.previews).toHaveLength(1);
    expect(data.previews[0].prNumber).toBe(42);
  });

  it('DELETE /api/projects/:id/previews/:previewId deletes a preview project', async () => {
    db.createProject({ id: 'dp', name: 'del-parent', repoUrl: 'https://github.com/test/repo' });
    db.createProject({
      id: 'dp-pr1',
      name: 'del-parent-pr-1',
      repoUrl: 'https://github.com/test/repo',
    });
    db.updateProject('dp-pr1', { parentProjectId: 'dp', isPreview: 1, prNumber: 1 });

    const res = await app.request('/api/projects/dp/previews/dp-pr1', { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('DELETE /api/projects/:id/previews/:previewId returns 404 for non-existent preview', async () => {
    db.createProject({ id: 'dp2', name: 'del-parent-2', repoUrl: 'https://github.com/test/repo' });

    const res = await app.request('/api/projects/dp2/previews/nonexistent', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // POST /api/env/scan
  // ---------------------------------------------------------------------------

  it('POST /api/env/scan returns 400 when repo_url missing', async () => {
    const res = await app.request('/api/env/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/env/scan returns empty vars when no env templates are found', async () => {
    const res = await app.request('/api/env/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/test/repo' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('vars');
    expect(body.vars).toEqual([]);
    expect(body.hasEnvExample).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:id/env/scan
  // ---------------------------------------------------------------------------

  it('POST /api/projects/:id/env/scan returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/env/scan', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /api/projects/:id/env/scan returns empty newVars when no env templates are found', async () => {
    db.createProject({ id: 'scan-p1', name: 'scan-app', repoUrl: 'https://github.com/test/repo' });
    const res = await app.request('/api/projects/scan-p1/env/scan', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('newVars');
    expect(body.newVars).toEqual([]);
    expect(body.existingVars).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Archive / Unarchive / Purge
  // ---------------------------------------------------------------------------

  it('GET /api/projects excludes archived projects by default', async () => {
    db.createProject({ id: 'active-1', name: 'active-app', repoUrl: 'https://github.com/u/a' });
    db.createProject({ id: 'arch-1', name: 'archived-app', repoUrl: 'https://github.com/u/b' });
    db.archiveProject('arch-1');

    const res = await app.request('/api/projects');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.projects[0].name).toBe('active-app');
  });

  it('GET /api/projects?include_archived=true includes archived projects', async () => {
    db.createProject({ id: 'active-2', name: 'active-app2', repoUrl: 'https://github.com/u/a2' });
    db.createProject({ id: 'arch-2', name: 'archived-app2', repoUrl: 'https://github.com/u/b2' });
    db.archiveProject('arch-2');

    const res = await app.request('/api/projects?include_archived=true');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    const names = body.projects.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['active-app2', 'archived-app2']);
  });

  it('POST /api/projects/:id/archive archives project and returns updated data', async () => {
    db.createProject({ id: 'arch-3', name: 'to-archive', repoUrl: 'https://github.com/u/c' });

    const res = await app.request('/api/projects/arch-3/archive', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('project');
    expect(ctx.pipeline.archive as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('arch-3');
  });

  it('POST /api/projects/:id/archive returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/archive', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /api/projects/:id/unarchive unarchives project and returns updated data', async () => {
    db.createProject({ id: 'unarch-1', name: 'to-unarchive', repoUrl: 'https://github.com/u/d' });
    db.archiveProject('unarch-1');

    const res = await app.request('/api/projects/unarch-1/unarchive', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('project');
    expect(ctx.pipeline.unarchive as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('unarch-1');
  });

  it('POST /api/projects/:id/unarchive returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/unarchive', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/projects/:id/purge without confirm returns 400', async () => {
    db.createProject({ id: 'purge-1', name: 'purge-app', repoUrl: 'https://github.com/u/e' });

    const res = await app.request('/api/projects/purge-1/purge', { method: 'DELETE' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Confirmation required');
  });

  it('DELETE /api/projects/:id/purge?confirm=true permanently deletes project', async () => {
    db.createProject({ id: 'purge-2', name: 'purge-app2', repoUrl: 'https://github.com/u/f' });

    const res = await app.request('/api/projects/purge-2/purge?confirm=true', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Project permanently deleted');
    expect(ctx.pipeline.remove as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'purge-2',
      ctx.cloudflare,
    );
  });

  it('DELETE /api/projects/:id/purge?confirm=true returns 404 for unknown project', async () => {
    const res = await app.request('/api/projects/nonexistent/purge?confirm=true', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/projects/:id calls archive instead of remove', async () => {
    db.createProject({ id: 'del-1', name: 'del-app', repoUrl: 'https://github.com/u/g' });

    const res = await app.request('/api/projects/del-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('archived');
    expect(ctx.pipeline.archive as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('del-1');
  });

  it('GET /api/action-runs?approval_status=pending excludes stale non-pending_approval rows', async () => {
    db.createProject({ id: 'ops-p1', name: 'ops-app', repoUrl: 'https://github.com/u/ops-app' });

    const activePendingId = db.createActionRun({
      projectId: 'ops-p1',
      triggerSource: 'auto_recovery',
      recoveryStrategy: 'recipe',
    });
    db.updateActionRunStatus(activePendingId, 'pending_approval');
    db.updateActionRunApproval(activePendingId, 'pending', 'rollback');

    const stalePendingId = db.createActionRun({
      projectId: 'ops-p1',
      triggerSource: 'auto_recovery',
      recoveryStrategy: 'recipe',
    });
    db.updateActionRunStatus(stalePendingId, 'failed', 'Server restarted');
    db.updateActionRunApproval(stalePendingId, 'pending', 'rollback');

    const res = await app.request('/api/action-runs?approval_status=pending');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.actionRuns).toHaveLength(1);
    expect(body.actionRuns[0].id).toBe(activePendingId);
  });
});
