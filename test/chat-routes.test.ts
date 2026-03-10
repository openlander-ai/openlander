import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../src/app.js';
import type { Database } from '../src/db/index.js';
import { createChatRoutes } from '../src/web/api/chat-routes.js';
import { createMockContext } from './helpers/web-route-mocks.js';

describe('Chat Routes', () => {
  let app: Hono;
  let ctx: AppContext;

  beforeEach(() => {
    const db = {
      close: vi.fn(),
    } as unknown as Database;
    ctx = createMockContext(db);
    app = new Hono();
    app.route('/api', createChatRoutes(ctx));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/agent/chat returns 400 when message is missing or empty', async () => {
    const missing = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const empty = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(empty.status).toBe(400);
  });

  it('POST /api/agent/chat returns 503 when agent is null', async () => {
    ctx.agent = null;

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(503);
  });

  it('POST /api/agent/chat returns 200 and streams NDJSON events', async () => {
    const release = vi.fn();
    const acquireSpy = vi.spyOn(ctx.deployQueue, 'acquire').mockResolvedValue(release);
    if (!ctx.agent) {
      throw new Error('Agent mock was not initialized');
    }
    const chatStreamMock = vi
      .fn()
      .mockImplementation(async (_msg: string, onEvent: (event: unknown) => Promise<void>) => {
        await onEvent({ type: 'session', sessionId: 'sess-1' });
        await onEvent({ type: 'thinking' });
        await onEvent({ type: 'message', content: 'hello from agent' });
        await onEvent({ type: 'done' });
      });
    ctx.agent.chatStream = chatStreamMock;

    const res = await app.request('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const text = await res.text();
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; content?: string });

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session' }),
        expect.objectContaining({ type: 'thinking' }),
        expect.objectContaining({ type: 'message', content: 'hello from agent' }),
        expect.objectContaining({ type: 'done' }),
      ]),
    );
    expect(acquireSpy).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
