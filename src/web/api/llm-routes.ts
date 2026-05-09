import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { aiOpsDisabledResponse } from './ai-ops-disabled.js';

export function createLlmRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/llm/suggest', aiOpsDisabledResponse);

  return api;
}
