import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { createSetupRoutes } from '../src/web/api/setup-routes.js';

function createApp() {
  const ctx = {
    db: {
      isPasswordSet: vi.fn().mockResolvedValue(false),
    },
    docker: {
      status: vi.fn().mockResolvedValue({ state: 'running' }),
    },
    traefik: {
      isRunning: vi.fn().mockResolvedValue(true),
    },
    llmVerified: true,
    config: {
      language: 'en',
      gitProviders: { github: { token: '', username: '' } },
    },
  } as unknown as AppContext;

  const app = new Hono();
  app.route('/api', createSetupRoutes(ctx));
  return app;
}

describe('Setup LLM routes disabled in 0.1', () => {
  it.each([
    ['POST', '/api/setup/llm'],
    ['POST', '/api/setup/llm/test'],
    ['DELETE', '/api/setup/llm'],
    ['GET', '/api/setup/providers'],
    ['POST', '/api/setup/providers'],
    ['POST', '/api/setup/providers/default'],
    ['DELETE', '/api/setup/providers/default-provider'],
    ['GET', '/api/setup/ai-features'],
    ['PUT', '/api/setup/ai-features'],
  ] as const)('%s %s returns FEATURE_DISABLED', async (method, path) => {
    const res = await createApp().request(path, { method });
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'FEATURE_DISABLED',
      code: 'FEATURE_DISABLED',
    });
  });

  it('reports LLM as disabled in setup status without blocking setup readiness', async () => {
    const res = await createApp().request('/api/setup/status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llm).toMatchObject({
      ok: false,
      disabled: true,
      provider: null,
      model: null,
    });
  });
});
