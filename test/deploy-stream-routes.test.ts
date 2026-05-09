import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { eventBus } from '../src/events/index.js';
import { createDeployStreamRoutes } from '../src/web/api/deploy-stream-routes.js';
import { createMockContext } from './helpers/web-route-mocks.js';

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
}));

type Diagnosis = {
  summary: string;
  rootCause: string;
  suggestedFixes: Array<{
    description: string;
    location?: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  rawAnalysis: string;
};

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for async deploy background work');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createDiagnosis(partial?: Partial<Diagnosis>): Diagnosis {
  return {
    summary: 'Dependency install failed',
    rootCause: 'Lockfile mismatch caused package manager failure.',
    suggestedFixes: [
      {
        description: 'Regenerate lockfile and commit before redeploying.',
        location: 'repo root',
        confidence: 'high',
      },
    ],
    rawAnalysis: 'raw diagnosis',
    ...partial,
  };
}

describe('createDeployStreamRoutes terminal failure handling', () => {
  let tmpDir: string;
  let db: Database;
  let app: Hono;
  let ctx: AppContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-stream-routes-'));
    db = new Database(join(tmpDir, 'test.db'));
    ctx = createMockContext(db);
    app = new Hono();
    app.route('/api', createDeployStreamRoutes(ctx));

    ctx.deployQueue.acquire = vi.fn().mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    eventBus.clear();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('emits deploy:failed immediately when buildDebugger is missing', async () => {
    ctx.buildDebugger = null;
    (ctx.planEngine.executePlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'failed',
      error: 'plan execution failed hard',
    });

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/no-debugger-app' }),
    });

    expect(res.status).toBe(200);
    await waitFor(() => failedEvents.length === 1);
    unsubscribe();

    expect(failedEvents[0]).toEqual({
      step: 'orchestrate',
      error: 'plan execution failed hard',
    });
    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
  });

  it('retries deterministic startup when user selects retry after diagnosis', async () => {
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('docker build failed at step 8'))
      .mockResolvedValueOnce({ plan_id: 'plan-retry' });
    (ctx.planEngine.executePlan as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'success',
      plan_id: 'plan-retry',
    });

    const diagnose = vi.fn().mockResolvedValue(createDiagnosis());
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];
    (ctx.questionBridge.ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { questionIndex: 0, selectedLabels: ['Retry deployment now'] },
    ]);

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/retry-app' }),
    });

    expect(res.status).toBe(200);
    await waitFor(
      () => (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mock.calls.length === 2,
    );
    unsubscribe();

    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({
        buildLog: 'docker build failed at step 8',
        failedStep: 'orchestrate',
      }),
    );
    expect(ctx.planEngine.executePlan).toHaveBeenCalledTimes(1);
    expect(failedEvents).toHaveLength(0);
  });

  it('emits deploy:failed after diagnosis when user selects cancel', async () => {
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('container failed before start'),
    );

    const diagnose = vi.fn().mockResolvedValue(createDiagnosis({ suggestedFixes: [] }));
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];
    (ctx.questionBridge.ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { questionIndex: 0, selectedLabels: ['Cancel'] },
    ]);

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/cancel-app' }),
    });

    expect(res.status).toBe(200);
    await waitFor(() => failedEvents.length === 1);
    unsubscribe();

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(failedEvents[0]).toEqual({
      step: 'orchestrate',
      error: 'container failed before start',
    });
  });

  it('emits deploy:needs-user-action for manual fix selection', async () => {
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('npm ci failed'),
    );

    ctx.buildDebugger = {
      diagnose: vi.fn().mockResolvedValue(
        createDiagnosis({
          suggestedFixes: [
            {
              description: 'Run npm install locally and commit updated lockfile.',
              location: 'repo root',
              confidence: 'high',
            },
          ],
        }),
      ),
    } as unknown as AppContext['buildDebugger'];

    (ctx.questionBridge.ask as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { questionIndex: 0, selectedLabels: ['Manual follow-up 1'] },
    ]);

    const userActionEvents: Array<{ category: string; title: string; description: string }> = [];
    const unsubscribeNeedsUserAction = eventBus.on('deploy:needs-user-action', (payload) => {
      userActionEvents.push({
        category: payload.category,
        title: payload.title,
        description: payload.description,
      });
    });

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribeFailed = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/manual-fix-app' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    await waitFor(() => userActionEvents.length === 1);
    unsubscribeNeedsUserAction();
    unsubscribeFailed();

    expect(userActionEvents[0]).toEqual({
      category: 'manual_followup_required',
      title: 'Manual fix required',
      description:
        'This suggested fix was not auto-applied: Run npm install locally and commit updated lockfile.',
    });
    expect(db.getProject(body.projectId)?.status).toBe('error');
    expect(failedEvents).toHaveLength(0);
  });

  it('emits deploy:failed when AI diagnosis throws', async () => {
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('build stage failed'),
    );

    const diagnose = vi.fn().mockRejectedValue(new Error('diagnosis model unavailable'));
    ctx.buildDebugger = { diagnose } as unknown as AppContext['buildDebugger'];

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/diagnose-failure-app' }),
    });

    expect(res.status).toBe(200);
    await waitFor(() => failedEvents.length === 1);
    unsubscribe();

    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(ctx.questionBridge.ask).not.toHaveBeenCalled();
    expect(failedEvents[0]).toEqual({
      step: 'orchestrate',
      error: 'build stage failed',
    });
  });

  it('stops deploy as failed when question bridge ask throws', async () => {
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('orchestration startup failed'),
    );

    ctx.buildDebugger = {
      diagnose: vi.fn().mockResolvedValue(createDiagnosis()),
    } as unknown as AppContext['buildDebugger'];
    (ctx.questionBridge.ask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('question bridge timeout'),
    );

    const failedEvents: Array<{ step: string; error: string }> = [];
    const unsubscribe = eventBus.on('deploy:failed', (payload) => {
      failedEvents.push({ step: payload.step, error: payload.error });
    });

    const res = await app.request('/api/projects/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: 'https://github.com/openlander/ask-failure-app' }),
    });

    expect(res.status).toBe(200);
    await waitFor(() => failedEvents.length === 1);
    unsubscribe();

    expect(failedEvents[0]).toEqual({
      step: 'orchestrate',
      error: 'orchestration startup failed',
    });
  });
});
