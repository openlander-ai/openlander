import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import type {
  AiOpsBriefingRow,
  AiOpsBriefingStatus,
  AiOpsProjectMode,
  AiOpsServiceOverrideMode,
  AiUsageLogRow,
} from '../../db/types.js';
import { formatAiOpsBriefingRow } from '../../monitor/ai-ops-briefing-format.js';
import {
  findService,
  resolveDeployableServiceForRoute,
  resolveProject,
} from './helpers/deployable-service-route-shared.js';

const PROJECT_MODES = new Set<AiOpsProjectMode>(['off', 'briefing']);
const SERVICE_MODES = new Set<AiOpsServiceOverrideMode>(['inherit', 'off', 'briefing']);
const BRIEFING_STATUSES = new Set<AiOpsBriefingStatus>(['open', 'acknowledged', 'resolved']);

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function readJsonBody(c: Context) {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isProjectMode(value: unknown): value is AiOpsProjectMode {
  return typeof value === 'string' && PROJECT_MODES.has(value as AiOpsProjectMode);
}

function isServiceMode(value: unknown): value is AiOpsServiceOverrideMode {
  return typeof value === 'string' && SERVICE_MODES.has(value as AiOpsServiceOverrideMode);
}

function numberFromBody(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function usageSummary(logs: AiUsageLogRow[]) {
  return {
    total_tokens: logs.reduce((total, row) => total + row.total_tokens, 0),
    input_tokens: logs.reduce((total, row) => total + row.input_tokens, 0),
    output_tokens: logs.reduce((total, row) => total + row.output_tokens, 0),
    cost_usd: logs.reduce((total, row) => total + (row.cost_usd ?? 0), 0),
    count: logs.length,
  };
}

async function formatBriefingWithUsage(ctx: AppContext, row: AiOpsBriefingRow) {
  const usage = await ctx.db.getAiUsageLogsByBriefing(row.id);
  return {
    ...formatAiOpsBriefingRow(row, { includeEvidence: true }),
    usage: usageSummary(usage),
  };
}

export function createAiOpsRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/ai-ops', async (c) => {
    const projectParam = c.req.param('id');
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
    }

    const [policy, budget, briefings] = await Promise.all([
      ctx.db.getAiOpsProjectPolicy(project.id),
      ctx.db.getAiOpsBriefingBudgetStatus(project.id),
      ctx.db.listAiOpsBriefingsByProject(project.id, { limit: 5, status: 'open' }),
    ]);

    return c.json({
      project_id: project.id,
      policy,
      budget,
      recent_briefings: briefings.map((row) => formatAiOpsBriefingRow(row)),
    });
  });

  api.patch('/projects/:id/ai-ops', async (c) => {
    const projectParam = c.req.param('id');
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
    }

    const body = await readJsonBody(c);
    const rawMode = body['mode'];
    if (rawMode !== undefined && !isProjectMode(rawMode)) {
      return c.json({ error: 'INVALID_FIELD', message: 'mode must be off or briefing' }, 400);
    }

    const policy = await ctx.db.setAiOpsProjectPolicy(project.id, {
      mode: isProjectMode(rawMode) ? rawMode : undefined,
      dailyBriefingLimit: numberFromBody(body['daily_briefing_limit']),
      fingerprintCooldownMinutes: numberFromBody(body['fingerprint_cooldown_minutes']),
    });
    const [budget, briefings] = await Promise.all([
      ctx.db.getAiOpsBriefingBudgetStatus(project.id),
      ctx.db.listAiOpsBriefingsByProject(project.id, { limit: 5, status: 'open' }),
    ]);

    return c.json({
      status: 'saved',
      project_id: project.id,
      policy,
      budget,
      recent_briefings: briefings.map((row) => formatAiOpsBriefingRow(row)),
    });
  });

  api.get('/projects/:id/ai-ops/briefings', async (c) => {
    const projectParam = c.req.param('id');
    const project = await resolveProject(ctx, projectParam);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
    }

    const rawStatus = c.req.query('status');
    const status =
      rawStatus && BRIEFING_STATUSES.has(rawStatus as AiOpsBriefingStatus)
        ? (rawStatus as AiOpsBriefingStatus)
        : undefined;
    const limit = parsePositiveInt(c.req.query('limit'), 20, 100);
    const briefings = await ctx.db.listAiOpsBriefingsByProject(project.id, { limit, status });

    return c.json({
      project_id: project.id,
      count: briefings.length,
      briefings: briefings.map((row) => formatAiOpsBriefingRow(row)),
    });
  });

  api.get('/projects/:p/services/:s/ai-ops', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;

    const [projectPolicy, serviceOverride, resolvedPolicy] = await Promise.all([
      ctx.db.getAiOpsProjectPolicy(resolved.project.id),
      ctx.db.getAiOpsServiceOverride(resolved.service.id),
      ctx.db.resolveAiOpsServicePolicy(resolved.project.id, resolved.service.id),
    ]);

    return c.json({
      project_id: resolved.project.id,
      service_id: resolved.service.id,
      project_policy: projectPolicy,
      service_override: serviceOverride,
      resolved_policy: resolvedPolicy,
    });
  });

  api.patch('/projects/:p/services/:s/ai-ops', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;

    const body = await readJsonBody(c);
    const rawMode = body['mode'];
    if (rawMode !== undefined && !isServiceMode(rawMode)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'mode must be inherit, off, or briefing' },
        400,
      );
    }

    const serviceOverride = await ctx.db.setAiOpsServiceOverride(resolved.service.id, {
      mode: isServiceMode(rawMode) ? rawMode : undefined,
    });
    const resolvedPolicy = await ctx.db.resolveAiOpsServicePolicy(
      resolved.project.id,
      resolved.service.id,
    );

    return c.json({
      status: 'saved',
      project_id: resolved.project.id,
      service_id: resolved.service.id,
      service_override: serviceOverride,
      resolved_policy: resolvedPolicy,
    });
  });

  api.get('/projects/:p/services/:s/ai-ops/briefings', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;

    const rawStatus = c.req.query('status');
    const status =
      rawStatus && BRIEFING_STATUSES.has(rawStatus as AiOpsBriefingStatus)
        ? (rawStatus as AiOpsBriefingStatus)
        : undefined;
    const limit = parsePositiveInt(c.req.query('limit'), 20, 100);
    const briefings = await ctx.db.listAiOpsBriefingsByService(resolved.service.id, {
      limit,
      status,
    });

    return c.json({
      project_id: resolved.project.id,
      service_id: resolved.service.id,
      count: briefings.length,
      briefings: briefings.map((row) => formatAiOpsBriefingRow(row)),
    });
  });

  api.get('/ai-ops/briefings/:id', async (c) => {
    const id = c.req.param('id');
    const briefing = await ctx.db.getAiOpsBriefing(id);
    if (!briefing) {
      return c.json({ error: 'NOT_FOUND', message: `AI Ops briefing not found: ${id}` }, 404);
    }

    return c.json({ briefing: await formatBriefingWithUsage(ctx, briefing) });
  });

  api.get('/services/:id/ai-ops', async (c) => {
    const serviceParam = c.req.param('id');
    const service = await findService(ctx, serviceParam);
    if (!service) {
      return c.json({ error: 'NOT_FOUND', message: `Service not found: ${serviceParam}` }, 404);
    }
    const project = service.project_id ? await ctx.db.getProject(service.project_id) : null;
    if (!project) {
      return c.json(
        { error: 'NOT_FOUND', message: `Project not found for service: ${service.id}` },
        404,
      );
    }

    const [projectPolicy, serviceOverride, resolvedPolicy] = await Promise.all([
      ctx.db.getAiOpsProjectPolicy(project.id),
      ctx.db.getAiOpsServiceOverride(service.id),
      ctx.db.resolveAiOpsServicePolicy(project.id, service.id),
    ]);

    return c.json({
      project_id: project.id,
      service_id: service.id,
      project_policy: projectPolicy,
      service_override: serviceOverride,
      resolved_policy: resolvedPolicy,
    });
  });

  return api;
}
