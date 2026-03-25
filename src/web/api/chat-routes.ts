import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { QuestionAnswer } from '../../lib/question-bridge.js';
import type { ChatStreamEvent } from '../../types/agent-events.js';

export function createChatRoutes(ctx: AppContext): Hono {
  const api = new Hono();
  let activeStream = false;

  api.post('/chat/stream', async (c) => {
    if (!ctx.agent) {
      return c.json({ error: 'LLM not configured' }, 503);
    }
    const agent = ctx.agent;

    if (activeStream) {
      return c.json({ error: 'Another chat stream is already active' }, 429);
    }

    const body = await c.req
      .json<{ message?: unknown; session_id?: unknown }>()
      .catch(() => ({ message: undefined, session_id: undefined }));

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    let sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';

    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }

    // Auto-generate session_id if not provided
    if (!sessionId) {
      sessionId = `domain-diag-${Date.now().toString(36)}`;
    }

    activeStream = true;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        const write = (event: ChatStreamEvent): void => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        try {
          await agent.chatStream(
            message,
            (event) => {
              write(event);
              return Promise.resolve();
            },
            sessionId,
          );
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          write({ type: 'error', error });
        } finally {
          activeStream = false;
          controller.close();
        }
      },
      cancel() {
        activeStream = false;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  api.post('/question/reply', async (c) => {
    const body = await c.req
      .json<{
        request_id?: unknown;
        requestId?: unknown;
        answers?: Array<{
          questionIndex?: unknown;
          selectedLabels?: unknown;
          customText?: unknown;
        }>;
      }>()
      .catch(() => ({ request_id: undefined, requestId: undefined, answers: undefined }));

    const requestId = body.request_id ?? body.requestId;
    if (typeof requestId !== 'string' || requestId.trim() === '') {
      return c.json({ error: 'request_id is required' }, 400);
    }

    if (!Array.isArray(body.answers)) {
      return c.json({ error: 'answers array is required' }, 400);
    }

    const answers: QuestionAnswer[] = [];
    for (const item of body.answers) {
      if (
        typeof item.questionIndex !== 'number' ||
        !Number.isInteger(item.questionIndex) ||
        item.questionIndex < 0 ||
        !Array.isArray(item.selectedLabels) ||
        !item.selectedLabels.every((label) => typeof label === 'string') ||
        (item.customText !== undefined && typeof item.customText !== 'string')
      ) {
        return c.json(
          {
            error:
              'Each answer must include questionIndex, selectedLabels, and optional customText',
          },
          400,
        );
      }

      answers.push({
        questionIndex: item.questionIndex,
        selectedLabels: item.selectedLabels,
        customText: item.customText,
      });
    }

    ctx.questionBridge.reply(requestId, answers);
    return c.json({ status: 'answered' });
  });

  api.post('/question/dismiss', (c) => {
    ctx.questionBridge.reject();
    return c.json({ status: 'dismissed' });
  });

  return api;
}
