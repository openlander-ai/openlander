import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../src/db/index.js';
import { eventBus } from '../src/events/index.js';
import { createDomainRoutes } from '../src/web/api/domain-routes.js';

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for async domain analysis');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createDomainRoutes', () => {
  let tmpDir: string;
  let db: Database;

  const cloudflare = {
    createTunnel: vi.fn().mockResolvedValue(undefined),
    removeTunnel: vi.fn().mockResolvedValue(undefined),
    listDomains: vi.fn().mockReturnValue(['api.example.com']),
  };

  const traefik = {
    start: vi.fn().mockResolvedValue(undefined),
  };

  const env = {
    setBulk: vi.fn().mockReturnValue(true),
  };

  const pipeline = {
    redeploy: vi.fn().mockResolvedValue({ success: true }),
  };

  const deployQueue = {
    acquire: vi.fn().mockResolvedValue(() => {}),
  };

  const questionBridge = {
    setActiveProject: vi.fn(),
    ask: vi.fn(),
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-domain-routes-'));
    db = new Database(join(tmpDir, 'test.db'));
    db.createProject({
      id: 'proj-1',
      name: 'demo-project',
      repoUrl: 'https://github.com/openlander/demo-project',
      branch: 'main',
    });

    cloudflare.createTunnel.mockClear();
    cloudflare.listDomains.mockClear();
    traefik.start.mockClear();
    env.setBulk.mockClear();
    pipeline.redeploy.mockClear();
    questionBridge.setActiveProject.mockClear();
    questionBridge.ask.mockClear();
  });

  afterEach(() => {
    eventBus.clear();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('maps domain and skips AI analysis when agent is null', async () => {
    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: null,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'https://api.example.com' }),
    });

    expect(response.status).toBe(201);
    expect(cloudflare.createTunnel).toHaveBeenCalledWith('proj-1', 'api.example.com');
    expect(questionBridge.ask).not.toHaveBeenCalled();
    expect(env.setBulk).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('asks approval and redeploys when agent suggests URL env updates', async () => {
    const agentEvents: string[] = [];
    eventBus.on('agent:event', (payload) => {
      if (payload.projectId === 'proj-1') {
        agentEvents.push(payload.event.type);
      }
    });

    const agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'thinking' });
            await onEvent({ type: 'tool_call', toolName: 'list_env_vars', arguments: {} });
            await onEvent({
              type: 'message',
              content:
                '{"needs_env_update":true,"reason":"public URL changed","env_updates":[{"key":"NEXT_PUBLIC_APP_URL","suggested":"https://api.example.com"}]}',
            });
            await onEvent({ type: 'done' });
          },
        ),
    };

    questionBridge.ask.mockResolvedValue([
      { questionIndex: 0, selectedLabels: ['Approve and redeploy'] },
    ]);

    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: agent as never,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(201);

    await waitFor(() => questionBridge.ask.mock.calls.length === 1);

    expect(agent.chatStream).toHaveBeenCalledOnce();
    expect(agentEvents).toContain('thinking');
    expect(agentEvents).toContain('tool_call');
    expect(questionBridge.setActiveProject).toHaveBeenCalledWith('proj-1');
    expect(questionBridge.setActiveProject).toHaveBeenCalledWith(null);
    expect(env.setBulk).toHaveBeenCalledWith('proj-1', {
      NEXT_PUBLIC_APP_URL: 'https://api.example.com',
    });
    expect(pipeline.redeploy).toHaveBeenCalledWith('proj-1');

    const timelineTypes = db
      .getTimelineEvents('proj-1')
      .map((event) => event.type)
      .slice(0, 12);
    expect(timelineTypes).toContain('agent_tool_call');
    expect(timelineTypes).toContain('question_pending');
  });

  it('does not ask question when AI reports no env change needed', async () => {
    const agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({
              type: 'message',
              content:
                '{"needs_env_update":false,"reason":"no URL env var found","env_updates":[]}',
            });
            await onEvent({ type: 'done' });
          },
        ),
    };

    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: agent as never,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(201);
    await waitFor(() => agent.chatStream.mock.calls.length === 1);
    expect(questionBridge.ask).not.toHaveBeenCalled();
    expect(env.setBulk).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
  });
});
