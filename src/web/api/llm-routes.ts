import { generateText } from 'ai';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('llm-routes');

export function createLlmRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/llm/suggest', async (c) => {
    if (!ctx.model) {
      return c.json({ error: 'LLM not configured' }, 503);
    }

    const body = await c.req
      .json<{ prompt?: unknown; project_id?: unknown; deploy_id?: unknown }>()
      .catch(() => ({ prompt: undefined, project_id: undefined, deploy_id: undefined }));

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const deployId = typeof body.deploy_id === 'string' ? body.deploy_id.trim() : undefined;

    if (!prompt || !projectId) {
      return c.json({ error: 'prompt and project_id are required' }, 400);
    }

    try {
      const response = await generateText({
        model: ctx.model,
        messages: [{ role: 'user', content: prompt }],
      });

      const suggestion = response.text.trim();
      const eventId = nanoid(16);

      ctx.db.createTimelineEvent({
        id: eventId,
        projectId,
        deployId,
        type: 'ai_suggestion',
        message: suggestion,
        detail: prompt,
        severity: 'info',
      });

      log.info({ projectId, eventId }, 'AI suggestion generated');
      return c.json({ suggestion, event_id: eventId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ err, projectId }, 'AI suggestion failed');
      return c.json({ error: `AI suggestion failed: ${message}` }, 500);
    }
  });

  return api;
}
