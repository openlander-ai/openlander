import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { ChatStreamEvent } from '../../types/agent-events.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('chat-routes');

export function createChatRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/agent/chat', async (c) => {
    const body = await c.req.json<{
      message?: string;
      projectId?: string;
      sessionId?: string;
    }>();

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return c.json({ error: 'INVALID_INPUT', message: 'message is required' }, 400);
    }

    if (!ctx.agent) {
      return c.json({ error: 'AGENT_UNAVAILABLE', message: 'Agent is not configured' }, 503);
    }

    const encoder = new TextEncoder();
    const sessionId = body.sessionId;

    return c.body(
      new ReadableStream({
        start(controller) {
          const pushEvent = (event: ChatStreamEvent): void => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };

          void (async () => {
            const release = await ctx.deployQueue.acquire();

            try {
              const agent = ctx.agent;
              if (!agent) throw new Error('Agent became unavailable');
              await agent.chatStream(
                message,
                // eslint-disable-next-line @typescript-eslint/require-await
                async (event) => {
                  pushEvent(event);
                },
                sessionId,
              );
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              log.error({ err, projectId: body.projectId }, 'Agent chat route streaming failed');
              pushEvent({ type: 'error', error: errorMessage });
            } finally {
              release();
              controller.close();
            }
          })().catch((err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : String(err);
            log.error({ err, projectId: body.projectId }, 'Chat route stream setup failed');
            pushEvent({ type: 'error', error: errorMessage });
            controller.close();
          });
        },
      }),
      200,
      {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    );
  });

  return api;
}
