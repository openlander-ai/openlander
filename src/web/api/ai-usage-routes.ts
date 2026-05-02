import { Hono } from 'hono';

import type { AppContext } from '../../app.js';

export function createAiUsageRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // --- Usage Summary ---

  api.get('/usage/summary', async (c) => {
    const projectId = c.req.query('projectId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const range = parseDateRange(from, to);

    if (range.invalid) {
      return c.json({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: null,
        callCount: 0,
      });
    }

    const filters = {
      projectId: projectId ?? undefined,
      from: range.from,
      to: range.to,
    };
    const [summary, callCount] = await Promise.all([
      ctx.db.getAiTokenSummaryFiltered(filters),
      ctx.db.countAiUsageLogs(filters),
    ]);

    return c.json({
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalCostUsd: summary.totalCostUsd,
      callCount,
    });
  });

  // --- Recent Usage Logs ---

  api.get('/usage/recent', async (c) => {
    const limitParam = c.req.query('limit');
    const projectId = c.req.query('projectId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const range = parseDateRange(from, to);

    const limit = Math.min(Math.max(parseInt(limitParam ?? '') || 100, 1), 500);

    if (range.invalid) {
      return c.json({ logs: [], count: 0 });
    }

    const filters = {
      projectId: projectId ?? undefined,
      from: range.from,
      to: range.to,
    };
    const [logs, total] = await Promise.all([
      ctx.db.getRecentAiUsageLogs({
        limit,
        ...filters,
      }),
      ctx.db.countAiUsageLogs(filters),
    ]);
    const sliced = logs.map(mapLogToCamelCase);

    return c.json({ logs: sliced, count: total });
  });

  return api;
}

function parseDateRange(
  from?: string,
  to?: string,
): {
  invalid: boolean;
  from?: Date;
  to?: Date;
} {
  if (!from && !to) {
    return { invalid: false };
  }

  const fromDate = from ? new Date(from) : new Date(0);
  const toDate = to ? new Date(to) : new Date();
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return { invalid: true };
  }

  return {
    invalid: false,
    from: fromDate,
    to: toDate,
  };
}

function mapLogToCamelCase(log: {
  id: string;
  project_id: string | null;
  session_id: string | null;
  action_type: string;
  model_name: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  tools_called: string | null;
  result: string | null;
  error_message: string | null;
  error_type: string | null;
  duration_ms: number | null;
  source: string | null;
  created_at: string;
}) {
  return {
    id: log.id,
    projectId: log.project_id,
    sessionId: log.session_id,
    actionType: log.action_type,
    modelName: log.model_name,
    provider: log.provider,
    inputTokens: log.input_tokens,
    outputTokens: log.output_tokens,
    totalTokens: log.total_tokens,
    costUsd: log.cost_usd,
    toolsCalled: log.tools_called,
    result: log.result,
    errorMessage: log.error_message,
    errorType: log.error_type,
    durationMs: log.duration_ms,
    source: log.source,
    createdAt: log.created_at,
  };
}
