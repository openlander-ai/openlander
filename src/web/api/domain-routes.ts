import { Hono } from 'hono';
import type { Context } from 'hono';
import { nanoid } from 'nanoid';

import type { Agent } from '../../llm/agent.js';
import type { AgentPool } from '../../llm/agent-pool.js';
import type { QuestionAnswer, QuestionBridge } from '../../lib/question-bridge.js';
import type { Database, ProjectRow, ServiceRow } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { DeployPipeline } from '../../pipeline/deploy.js';
import type { DeployQueue } from '../../pipeline/deploy-queue.js';
import type { CloudflareTunnelManager } from '../../pipeline/cloudflare.js';
import type { EnvManager } from '../../pipeline/env.js';
import type { TraefikManager } from '../../pipeline/traefik.js';
import type { ChatStreamEvent } from '../../types/agent-events.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const log = createModuleLogger('domain-routes');

interface DomainRouteContext {
  db: Database;
  cloudflare: CloudflareTunnelManager;
  traefik: TraefikManager;
  agent: Agent | null;
  env: EnvManager;
  pipeline: DeployPipeline;
  deployQueue: DeployQueue;
  agentPool?: AgentPool | null;
  questionBridge: QuestionBridge;
}

export function createDomainRoutes(ctx: DomainRouteContext): Hono {
  const routes = new Hono();

  async function resolveService(c: Context): Promise<
    | {
        project: ProjectRow;
        service: ServiceRow;
      }
    | Response
  > {
    const p = c.req.param('p') ?? '';
    const s = c.req.param('s') ?? '';
    const project = (await ctx.db.getProject(p)) ?? (await ctx.db.getProjectByName(p));
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${p}` }, 404);
    }
    const service = await ctx.db.getService(s);
    if (!service || service.project_id !== project.id) {
      return c.json({ error: 'NOT_FOUND', message: `Service not found: ${s}` }, 404);
    }
    return { project, service };
  }

  routes.get('/projects/:p/services/:s/domains', async (c) => {
    const resolved = await resolveService(c);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;
    const domains = await ctx.cloudflare.listDomainsForService(service.id);
    return c.json({
      projectId: project.id,
      serviceId: service.id,
      count: domains.length,
      domains,
    });
  });

  routes.post('/projects/:p/services/:s/domains', async (c) => {
    const resolved = await resolveService(c);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;

    const body = await c.req.json<{ domain?: string }>();
    if (!body.domain) {
      return c.json({ error: 'MISSING_FIELD', message: 'domain is required' }, 400);
    }

    const domain = normalizeDomainParam(body.domain);

    try {
      await ctx.traefik.start();
    } catch (err) {
      log.debug(
        { err, projectId: project.id, serviceId: service.id, domain },
        'Traefik startup failed',
      );
    }

    try {
      await ctx.cloudflare.createTunnelForService(service.id, domain);
      const mappings = await ctx.cloudflare.listDomainsForService(service.id);
      return c.json(
        {
          status: 'mapped',
          projectId: project.id,
          serviceId: service.id,
          domain,
          totalDomains: mappings.length,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_CREATE_FAILED', message }, 400);
    }
  });

  routes.delete('/projects/:p/services/:s/domains/:domain', async (c) => {
    const resolved = await resolveService(c);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;

    const domainParam = decodeURIComponent(c.req.param('domain'));
    const domain = normalizeDomainParam(domainParam);

    try {
      await ctx.cloudflare.removeTunnelForService(service.id, domain);
      const mappings = await ctx.cloudflare.listDomainsForService(service.id);
      return c.json({
        status: 'unmapped',
        projectId: project.id,
        serviceId: service.id,
        domain,
        totalDomains: mappings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_DELETE_FAILED', message }, 400);
    }
  });

  routes.post('/projects/:id/domains', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ domain?: string }>();
    if (!body.domain) {
      return c.json({ error: 'MISSING_FIELD', message: 'domain is required' }, 400);
    }

    const domain = normalizeDomainParam(body.domain);

    // Ensure Traefik has File Provider before adding domain routes
    try {
      await ctx.traefik.start();
    } catch (err) {
      log.debug({ err, projectId: project.id, domain }, 'Traefik startup failed');
      /* startup handles errors */
    }

    try {
      await ctx.cloudflare.createTunnel(project.id, domain);
      const mappings = await ctx.cloudflare.listDomains(project.id);
      void runDomainPostAddAnalysis(ctx, {
        projectId: project.id,
        projectName: project.name,
        domain,
      });
      return c.json(
        {
          status: 'mapped',
          projectId: project.id,
          domain,
          totalDomains: mappings.length,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_CREATE_FAILED', message }, 400);
    }
  });

  routes.delete('/projects/:id/domains/:domain', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const domainParam = decodeURIComponent(c.req.param('domain'));
    const domain = normalizeDomainParam(domainParam);

    try {
      await ctx.cloudflare.removeTunnel(project.id, domain);
      const mappings = await ctx.cloudflare.listDomains(project.id);
      return c.json({
        status: 'unmapped',
        projectId: project.id,
        domain,
        totalDomains: mappings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_DELETE_FAILED', message }, 400);
    }
  });

  routes.get('/projects/:id/domains', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const domains = await ctx.cloudflare.listDomains(project.id);
    return c.json({
      projectId: project.id,
      count: domains.length,
      domains,
    });
  });

  return routes;
}

type DomainAnalysisPayload = {
  projectId: string;
  projectName: string;
  domain: string;
};

type EnvUpdateProposal = {
  key: string;
  suggested: string;
  reason?: string;
};

type DomainAnalysisResult = {
  needs_env_update: boolean;
  reason?: string;
  env_updates?: EnvUpdateProposal[];
};

async function runDomainPostAddAnalysis(
  ctx: DomainRouteContext,
  payload: DomainAnalysisPayload,
): Promise<void> {
  if (!ctx.agent) {
    return;
  }

  const { projectId, projectName, domain } = payload;
  const sessionId = `domain-analysis-${projectId}-${Date.now().toString(36)}`;
  let finalMessage = '';

  createTimelineEvent(ctx.db, {
    projectId,
    type: 'agent_thinking',
    message: `Domain impact analysis started for ${domain}`,
  });

  try {
    await ctx.agent.chatStream(
      [
        `프로젝트 ${projectName}에 새 도메인 ${domain}이 추가됨. 환경변수 중 URL/도메인 관련 변수가 있는지 확인하고, 변경이 필요하면 알려주세요.`,
        'Use existing tools first (scan_project, list_env_vars, get_deploy_status).',
        'Return ONLY JSON in this exact shape:',
        '{"needs_env_update":boolean,"reason":"string","env_updates":[{"key":"string","suggested":"string","reason":"string"}]}',
        'Set env_updates to [] when no change is required.',
      ].join('\n'),
      async (event) => {
        await emitAgentTimelineEvent(ctx, projectId, event);
        if (event.type === 'message') {
          finalMessage += event.content;
        }
      },
      sessionId,
    );
  } catch (err) {
    log.warn({ err, projectId, domain }, 'Domain post-add analysis failed');
    return;
  }

  const parsed = parseDomainAnalysisResult(finalMessage);
  const updates = (parsed?.env_updates ?? []).filter(
    (entry): entry is EnvUpdateProposal =>
      typeof entry.key === 'string' &&
      entry.key.trim().length > 0 &&
      typeof entry.suggested === 'string' &&
      entry.suggested.trim().length > 0,
  );

  if (!parsed?.needs_env_update || updates.length === 0) {
    return;
  }

  await requestEnvUpdateApprovalAndRedeploy(ctx, {
    projectId,
    projectName,
    domain,
    reason: parsed.reason,
    updates,
  });
}

async function emitAgentTimelineEvent(
  ctx: DomainRouteContext,
  projectId: string,
  event: ChatStreamEvent,
): Promise<void> {
  await eventBus.emit('agent:event', {
    projectId,
    event: {
      ...event,
      timestamp: new Date().toISOString(),
    },
  });

  if (event.type === 'thinking') {
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'agent_thinking',
      message: 'Analyzing domain impact',
    });
    return;
  }

  if (event.type === 'tool_call') {
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'agent_tool_call',
      message: `Domain analysis called tool: ${event.toolName}`,
      toolName: event.toolName,
      detail: JSON.stringify(event.arguments),
    });
    return;
  }

  if (event.type === 'error') {
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'error',
      message: `Domain analysis failed: ${event.error}`,
      severity: 'error',
    });
  }
}

function parseDomainAnalysisResult(raw: string): DomainAnalysisResult | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as DomainAnalysisResult;
  } catch {
    const jsonBlock = trimmed.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ?? trimmed;
    try {
      return JSON.parse(jsonBlock) as DomainAnalysisResult;
    } catch {
      return null;
    }
  }
}

async function requestEnvUpdateApprovalAndRedeploy(
  ctx: DomainRouteContext,
  args: {
    projectId: string;
    projectName: string;
    domain: string;
    reason?: string;
    updates: EnvUpdateProposal[];
  },
): Promise<void> {
  const { projectId, projectName, domain, reason, updates } = args;
  const updateSummary = updates.map((entry) => `${entry.key}=${entry.suggested}`).join('\n');

  createTimelineEvent(ctx.db, {
    projectId,
    type: 'question_pending',
    message: `AI suggests ${String(updates.length)} URL/domain env update(s) for ${domain}`,
    detail: updateSummary,
  });

  ctx.questionBridge.setActiveProject(projectId);

  let answers: QuestionAnswer[] = [];
  try {
    answers = await ctx.questionBridge.ask({
      id: nanoid(16),
      questions: [
        {
          header: 'Domain added — update environment variables?',
          question: [
            `Project: ${projectName}`,
            `New domain: ${domain}`,
            reason ? `Reason: ${reason}` : undefined,
            'Suggested updates:',
            updateSummary,
          ]
            .filter((line): line is string => typeof line === 'string')
            .join('\n'),
          options: [{ label: 'Approve and redeploy' }, { label: 'Skip for now' }],
          metadata: {
            source: 'domain_post_add_analysis',
            updates,
          },
        },
      ],
    });
  } catch (err) {
    log.warn({ err, projectId, domain }, 'Domain env update approval timed out');
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'status',
      message: 'Domain env update request timed out',
      severity: 'warning',
    });
    ctx.questionBridge.setActiveProject(null);
    return;
  }

  ctx.questionBridge.setActiveProject(null);
  const approved = answers.some((answer) => answer.selectedLabels.includes('Approve and redeploy'));
  if (!approved) {
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'status',
      message: 'User skipped AI-suggested domain env updates',
    });
    return;
  }

  const vars = Object.fromEntries(updates.map((entry) => [entry.key, entry.suggested]));
  await ctx.env.setBulk(projectId, vars);

  createTimelineEvent(ctx.db, {
    projectId,
    type: 'status',
    message: `Updated ${String(updates.length)} env var(s). Triggering redeploy...`,
  });

  // Per-project lock (1.0 GA): different projects can redeploy concurrently;
  // a same-project redeploy already in flight is rejected with a logged error.
  const lockSessionId = `domain-redeploy-${projectId}-${Date.now().toString(36)}`;
  const acquired = ctx.agentPool
    ? ctx.agentPool.acquireProjectLock(projectId, lockSessionId)
    : true;
  if (!acquired) {
    const lock = ctx.agentPool?.getProjectLock(projectId);
    log.warn(
      { projectId, lockSessionId: lock?.sessionId },
      'Skipping domain env redeploy: project lock already held',
    );
    createTimelineEvent(ctx.db, {
      projectId,
      type: 'status',
      message: 'Domain env redeploy skipped: project is already deploying',
      severity: 'warning',
    });
    return;
  }
  void (async () => {
    try {
      await ctx.pipeline.redeploy(projectId);
    } catch (err: unknown) {
      log.error({ err, projectId, domain }, 'Domain env update redeploy failed');
      createTimelineEvent(ctx.db, {
        projectId,
        type: 'error',
        message: `Redeploy failed after domain env update: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error',
      });
    } finally {
      ctx.agentPool?.releaseProjectLock(projectId, lockSessionId);
    }
  })();
}

function createTimelineEvent(
  db: Database,
  input: {
    projectId: string;
    type: string;
    message: string;
    detail?: string;
    severity?: 'info' | 'warning' | 'error';
    toolName?: string;
  },
): void {
  void db
    .createTimelineEvent({
      id: nanoid(16),
      projectId: input.projectId,
      type: input.type,
      message: input.message,
      detail: input.detail,
      severity: input.severity,
      toolName: input.toolName,
    })
    .catch((err: unknown) => {
      log.warn({ err, projectId: input.projectId }, 'Failed to create domain timeline event');
    });
}

function normalizeDomainParam(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '')
    .replace(/\.$/, '');
}
