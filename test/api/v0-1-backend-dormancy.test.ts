import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createChatRoutes } from '../../src/web/api/chat-routes.js';
import { createLlmRoutes } from '../../src/web/api/llm-routes.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function createApiApp(routes: Hono): Hono {
  const app = new Hono();
  app.route('/api', routes);
  return app;
}

describe('v0.1 backend dormancy contracts', () => {
  it('keeps built-in chat and LLM suggestion routes disabled', async () => {
    const ctx = {} as AppContext;
    const chatApp = createApiApp(createChatRoutes(ctx));
    const llmApp = createApiApp(createLlmRoutes(ctx));

    const chat = await chatApp.request('/api/chat/stream', { method: 'POST' });
    expect(chat.status).toBe(410);
    await expect(chat.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });

    const suggest = await llmApp.request('/api/llm/suggest', { method: 'POST' });
    expect(suggest.status).toBe(410);
    await expect(suggest.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('keeps MCP question bridge routes out of the dormant chat module', () => {
    const chatRoutes = readRepoFile('src/web/api/chat-routes.ts');
    const projectCompatRoutes = readRepoFile('src/web/api/project-compat-routes.ts');

    expect(chatRoutes).not.toContain("'/question/reply'");
    expect(chatRoutes).not.toContain("'/question/dismiss'");
    expect(projectCompatRoutes).toContain("api.post('/question/reply'");
    expect(projectCompatRoutes).toContain("api.post('/question/dismiss'");
  });

  it('keeps platform MCP tools opt-in by default', () => {
    const configSource = readRepoFile('src/config/index.ts');
    const appSource = readRepoFile('src/app.ts');
    const mcpServerSource = readRepoFile('src/mcp/server.ts');

    expect(configSource).toContain('platformTools: false');
    expect(appSource).toContain('if (config.mcp.platformTools === true)');
    expect(mcpServerSource).toContain('ctx.config.mcp.platformTools === true');
  });
});
