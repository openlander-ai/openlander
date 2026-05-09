import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { aiOpsDisabledResponse } from './ai-ops-disabled.js';

export function createChatRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  // Built-in web chat is dormant in v0.1. MCP request_input question bridge
  // responses are handled by project-compat-routes.ts under /question/*.
  api.post('/chat/stream', aiOpsDisabledResponse);

  return api;
}
