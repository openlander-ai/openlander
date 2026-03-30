import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { QuestionAnswer } from '../../lib/question-bridge.js';
import type { ChatStreamEvent } from '../../types/agent-events.js';
import type { ContextScope } from '../../llm/context-assembler.js';

export function createChatRoutes(ctx: AppContext): Hono {
  const api = new Hono();
  const activeStreams = new Map<string, boolean>();

  api.post('/chat/stream', async (c) => {
    if (!ctx.config.ai.webAgent.enabled) {
      return c.json({ error: 'Web agent is disabled' }, 503);
    }

    if (!ctx.agentPool) {
      return c.json({ error: 'LLM not configured' }, 503);
    }

    const body = await c.req
      .json<{ message?: unknown; session_id?: unknown; projectId?: unknown }>()
      .catch(() => ({ message: undefined, session_id: undefined, projectId: undefined }));

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    let sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : undefined;

    if (!message) {
      return c.json({ error: 'message is required' }, 400);
    }

    // Derive session key: project-scoped if projectId provided, otherwise auto-generated
    if (!sessionId) {
      sessionId = projectId ? `project:${projectId}` : `web-agent-${Date.now().toString(36)}`;
    }

    const scope: ContextScope | undefined = projectId ? { type: 'project', projectId } : undefined;

    if (activeStreams.get(sessionId)) {
      return c.json({ error: 'Another message is being processed for this session' }, 429);
    }

    const agent = ctx.agentPool.getOrCreate(sessionId);
    activeStreams.set(sessionId, true);

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
            scope,
          );
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          write({ type: 'error', error });
        } finally {
          activeStreams.delete(sessionId);
          ctx.agentPool?.release(sessionId);
          controller.close();
        }
      },
      cancel() {
        activeStreams.delete(sessionId);
        ctx.agentPool?.release(sessionId);
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
