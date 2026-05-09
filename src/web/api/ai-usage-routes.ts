import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { aiOpsDisabledResponse } from './ai-ops-disabled.js';

export function createAiUsageRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/usage/summary', aiOpsDisabledResponse);
  api.get('/usage/recent', aiOpsDisabledResponse);
  api.get('/ai-usage/summary', aiOpsDisabledResponse);
  api.get('/ai-usage/recent', aiOpsDisabledResponse);

  return api;
}
