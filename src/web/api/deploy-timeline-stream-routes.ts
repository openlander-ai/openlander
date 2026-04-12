import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import type { Context, Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { ProjectRow } from '../../db/types.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { postDeployCleanup } from '../../pipeline/cleanup.js';
import { generatePostDeployInsights } from '../../pipeline/post-deploy-insight.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const log = createModuleLogger('api');

const ENV_STYLE_KEYS = new Set(['envvars', 'environmentvariables']);
const SECRET_FIELD_PATTERN =
  /(password|secret|token|credential|api[_-]?key|private[_-]?key|ssh[_-]?key|access[_-]?key|auth[_-]?token)/i;

function normalizeSecretKeyName(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '');
}

function isEnvStyleKey(key: string): boolean {
  return ENV_STYLE_KEYS.has(normalizeSecretKeyName(key));
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SECRET_FIELD_PATTERN.test(normalized);
}

export function sanitizeToolResultForStream(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultForStream(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(source)) {
    if (isEnvStyleKey(key)) {
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        const maskedEnv: Record<string, string> = {};
        for (const envKey of Object.keys(nestedValue as Record<string, unknown>)) {
          maskedEnv[envKey] = '***';
        }
        sanitized[key] = maskedEnv;
      } else {
        sanitized[key] = '***';
      }
      continue;
    }

    if (isSecretLikeKey(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }

    sanitized[key] = sanitizeToolResultForStream(nestedValue);
  }

  return sanitized;
}

type DeployAgentState = {
  agentStarted: boolean;
  fallbackTriggered: boolean;
};

type FallbackTimerRef = {
  fallbackTimer: ReturnType<typeof setTimeout> | null;
};

type StreamTimeoutRef = {
  streamTimeout: ReturnType<typeof setTimeout> | null;
};

type ScopedProject = {
  scope: string;
  sourceProjectId: string;
  isChild: boolean;
};

type TimelineEvent = {
  type: string;
  message: string;
  projectId: string;
  id?: string;
  timestamp?: string;
  percent?: number;
  detail?: string | null;
  severity?: 'info' | 'warning' | 'error';
  toolName?: string;
  actionButtons?: unknown;
  deployId?: string;
  [key: string]: unknown;
};

type ResolveScopedProject = (
  sourceProjectId: string,
  explicitScope?: unknown,
  explicitParentProjectId?: unknown,
) => ScopedProject | null;

type StreamHandlerContext = {
  project: ProjectRow;
  ctx: AppContext;
  write: (data: TimelineEvent) => void;
  emitTimelineEvent: (data: TimelineEvent) => void;
  resolveScopedProject: ResolveScopedProject;
  deployState: DeployAgentState;
  fallbackTimerRef: FallbackTimerRef;
  clearStreamTimeout: () => void;
  closeStream: () => void;
};

const AGENT_START_EVENT_TYPES = new Set(['thinking', 'tool_call', 'question', 'message']);

export function markAgentStarted(
  deployState: DeployAgentState,
  eventType: string,
  fallbackTimerRef: FallbackTimerRef,
): void {
  if (!AGENT_START_EVENT_TYPES.has(eventType)) return;

  if (!deployState.agentStarted) {
    deployState.agentStarted = true;
    if (fallbackTimerRef.fallbackTimer) {
      clearTimeout(fallbackTimerRef.fallbackTimer);
      fallbackTimerRef.fallbackTimer = null;
    }
  }
}

export function shouldSuppressAgentEvent(deployState: DeployAgentState): boolean {
  return deployState.fallbackTriggered;
}

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${String(diffSec)}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${String(diffDay)}d ago`;
}

function createScopedProjectResolver(
  project: ProjectRow,
  ctx: AppContext,
  childProjectCache: Map<string, ProjectRow | null>,
): ResolveScopedProject {
  return (sourceProjectId, explicitScope, explicitParentProjectId) => {
    if (sourceProjectId === project.id) {
      const scope =
        typeof explicitScope === 'string' && explicitScope.trim().length > 0
          ? explicitScope
          : 'project';
      return { scope, sourceProjectId, isChild: false };
    }

    if (explicitParentProjectId === project.id) {
      const scope =
        typeof explicitScope === 'string' && explicitScope.trim().length > 0
          ? explicitScope
          : sourceProjectId;
      return { scope, sourceProjectId, isChild: true };
    }

    if (!childProjectCache.has(sourceProjectId)) {
      childProjectCache.set(sourceProjectId, ctx.db.getProject(sourceProjectId) ?? null);
    }

    const childProject = childProjectCache.get(sourceProjectId);
    if (!childProject || childProject.parent_project_id !== project.id) {
      return null;
    }

    const inferredScope =
      childProject.name.startsWith(`${project.name}/`) &&
      childProject.name.length > `${project.name}/`.length
        ? childProject.name.slice(project.name.length + 1)
        : childProject.name;
    const scope =
      typeof explicitScope === 'string' && explicitScope.trim().length > 0
        ? explicitScope
        : inferredScope;

    return { scope, sourceProjectId, isChild: true };
  };
}

function registerDeployLifecycleHandlers(handlerCtx: StreamHandlerContext): Array<() => void> {
  const { project, ctx, emitTimelineEvent, resolveScopedProject, clearStreamTimeout, closeStream } =
    handlerCtx;

  return [
    eventBus.on('deploy:start', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      emitTimelineEvent({
        type: scoped.isChild ? 'log' : 'status',
        message: payload.message ?? 'Starting deployment...',
        projectId: project.id,
        percent: scoped.isChild ? undefined : 0,
        stepName: scoped.isChild ? undefined : 'Preparing',
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
    eventBus.on('deploy:clone', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      emitTimelineEvent({
        type: scoped.isChild ? 'log' : 'status',
        message: payload.message ?? `Cloning repository (${payload.commitSha.slice(0, 7)})`,
        projectId: project.id,
        percent: scoped.isChild ? undefined : 15,
        stepName: scoped.isChild ? undefined : 'Clone',
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
    eventBus.on('deploy:build', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      emitTimelineEvent({
        type: scoped.isChild ? 'log' : 'status',
        message:
          payload.message ??
          `Docker image built (${String(Math.round(payload.durationMs / 1000))}s)`,
        projectId: project.id,
        percent: scoped.isChild ? undefined : 60,
        stepName: scoped.isChild ? undefined : 'Build',
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        durationMs: payload.durationMs,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
    eventBus.on('deploy:run', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      emitTimelineEvent({
        type: scoped.isChild ? 'log' : 'status',
        message: payload.message ?? `Starting container on port ${String(payload.port)}`,
        projectId: project.id,
        percent: scoped.isChild ? undefined : 90,
        stepName: scoped.isChild ? undefined : 'Start',
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
    eventBus.on('deploy:success', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;

      if (scoped.isChild) {
        emitTimelineEvent({
          type: 'log',
          message:
            payload.message ??
            `Service complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
          projectId: project.id,
          phase: payload.phase,
          scope: scoped.scope,
          status: payload.status,
          durationMs: payload.totalDurationMs,
          sourceProjectId: scoped.sourceProjectId,
        });
        return;
      }

      void (async () => {
        try {
          const insights = await generatePostDeployInsights(
            {
              projectId: payload.projectId,
              totalDurationMs: payload.totalDurationMs,
              url: payload.url,
            },
            ctx.docker,
            ctx.db,
            ctx.config.language,
          );

          for (const insight of insights) {
            emitTimelineEvent({
              type: 'insight',
              message: insight.title,
              detail: insight.detail ?? null,
              severity: insight.severity,
              actionButtons: insight.actions.length > 0 ? insight.actions : undefined,
              projectId: project.id,
            });
          }
        } catch (err) {
          log.warn({ err }, 'Post-deploy insight generation failed');
        }

        try {
          postDeployCleanup();
        } catch (err) {
          log.warn({ err }, 'Post-deploy cleanup failed');
        }

        emitTimelineEvent({
          type: 'complete',
          message:
            payload.message ??
            `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s`,
          url: payload.url,
          projectId: project.id,
          percent: 100,
          stepName: 'Complete',
          phase: payload.phase,
          scope: scoped.scope,
          status: payload.status,
          durationMs: payload.totalDurationMs,
          sourceProjectId: scoped.sourceProjectId,
        });
        clearStreamTimeout();
        closeStream();
      })();
    }),
    eventBus.on('deploy:failed', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      emitTimelineEvent({
        type: 'error',
        message: payload.message ?? `Deploy failed at ${payload.step}: ${payload.error}`,
        detail: payload.buildLog ?? null,
        projectId: project.id,
        percent: -1,
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        durationMs: payload.durationMs,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
  ];
}

function registerBuildEventHandlers(handlerCtx: StreamHandlerContext): Array<() => void> {
  const { project, write, emitTimelineEvent, resolveScopedProject } = handlerCtx;

  return [
    eventBus.on('build:suggest', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'status',
        message: `Suggestion: ${payload.suggestion}`,
        projectId: project.id,
      });
    }),
    eventBus.on('build:inform', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'status',
        message: `Build analysis: ${payload.summary}`,
        projectId: project.id,
      });
    }),
    eventBus.on('build:output', (payload) => {
      const scoped = resolveScopedProject(
        payload.projectId,
        payload.scope,
        payload.parentProjectId,
      );
      if (!scoped) return;
      write({
        type: 'log',
        message: payload.message ?? payload.line,
        projectId: project.id,
        phase: payload.phase,
        scope: scoped.scope,
        status: payload.status,
        durationMs: payload.durationMs,
        logChunk: payload.logChunk ?? payload.line,
        sourceProjectId: scoped.sourceProjectId,
      });
    }),
  ];
}

function registerComposeEventHandlers(handlerCtx: StreamHandlerContext): Array<() => void> {
  const { project, emitTimelineEvent, deployState, fallbackTimerRef, closeStream } = handlerCtx;

  const markComposeFallback = () => {
    deployState.fallbackTriggered = true;
    if (fallbackTimerRef.fallbackTimer) {
      clearTimeout(fallbackTimerRef.fallbackTimer);
      fallbackTimerRef.fallbackTimer = null;
    }
  };

  return [
    eventBus.on('compose:start', (payload) => {
      if (payload.projectId !== project.id) return;
      markComposeFallback();
      emitTimelineEvent({
        type: 'status',
        message: `Compose build starting (${String(payload.serviceCount)} service${payload.serviceCount > 1 ? 's' : ''})`,
        projectId: project.id,
      });
    }),
    eventBus.on('compose:up', (payload) => {
      if (payload.projectId !== project.id) return;
      markComposeFallback();
      emitTimelineEvent({
        type: 'complete',
        message: `Compose deploy complete — ${String(payload.services.length)} service${payload.services.length > 1 ? 's' : ''} running`,
        projectId: project.id,
      });
      closeStream();
    }),
    eventBus.on('compose:failed', (payload) => {
      if (payload.projectId !== project.id) return;
      markComposeFallback();
      emitTimelineEvent({
        type: 'error',
        message: `Compose deploy failed: ${payload.error}`,
        projectId: project.id,
      });
    }),
  ];
}

function registerRecoveryEventHandlers(handlerCtx: StreamHandlerContext): Array<() => void> {
  const { project, emitTimelineEvent } = handlerCtx;

  return [
    eventBus.on('recovery:start', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'recovery_start',
        message: `Auto-Recovery Attempt ${String(payload.attempt)}/3`,
        detail: payload.error,
        projectId: project.id,
      });
    }),
    eventBus.on('recovery:success', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'recovery_success',
        message: `Recovery Successful (attempt ${String(payload.attempt)}, ${String(Math.round(payload.durationMs / 1000))}s)`,
        projectId: project.id,
        durationMs: payload.durationMs,
        tokenCount: payload.tokenCount,
        costUsd: payload.costUsd,
      });
    }),
    eventBus.on('recovery:failed', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'recovery_failed',
        message: `Recovery Failed (attempt ${String(payload.attempt)})`,
        detail: payload.error,
        projectId: project.id,
      });
    }),
    eventBus.on('recovery:exhausted', (payload) => {
      if (payload.projectId !== project.id) return;
      emitTimelineEvent({
        type: 'recovery_exhausted',
        message: `Recovery Exhausted after ${String(payload.totalAttempts)} attempts`,
        detail: payload.lastError,
        projectId: project.id,
      });
    }),
  ];
}

function handleInitialStatusCheck(
  ctx: AppContext,
  project: ProjectRow,
  write: (data: TimelineEvent) => void,
  closeStream: () => void,
): boolean {
  const fresh = ctx.db.getProject(project.id);
  if (!fresh) {
    return false;
  }

  if (fresh.status === 'running' || fresh.status === 'error' || fresh.status === 'stopped') {
    const lastDeploy = ctx.db.getLastDeployLog(project.id);
    if (lastDeploy) {
      const ago = formatRelativeTime(lastDeploy.created_at);
      const duration = lastDeploy.duration_ms
        ? `${String(Math.round(lastDeploy.duration_ms / 1000))}s`
        : '';
      const trigger = lastDeploy.trigger;
      const commitInfo = lastDeploy.commit_sha ? ` (${lastDeploy.commit_sha.slice(0, 7)})` : '';

      write({
        id: `last-deploy-${lastDeploy.id}`,
        type: 'status',
        message: `Last deploy: ${trigger}${commitInfo} — ${ago}${duration ? `, took ${duration}` : ''}`,
        projectId: project.id,
      });
    }

    if (fresh.status === 'running') {
      write({
        id: 'current-running',
        type: 'complete',
        message: 'Currently running',
        projectId: project.id,
      });
    } else if (fresh.status === 'error') {
      const lastLog = ctx.db.getLastDeployLog(project.id);
      const isBuildFailure =
        lastLog?.status === 'failed' && lastLog.build_log?.includes('Build failed');
      write({
        id: 'current-error',
        type: 'error',
        message: isBuildFailure ? 'Build failed' : 'Container crashed',
        projectId: project.id,
      });
    } else {
      write({
        id: 'current-stopped',
        type: 'status',
        message: 'Stopped',
        projectId: project.id,
      });
    }

    closeStream();
    return true;
  }

  write({
    id: 'current-building',
    type: 'status',
    message: `Build in progress (${fresh.status})...`,
    projectId: project.id,
  });
  return false;
}

function handleBuildStreamRoute(c: Context, ctx: AppContext, project: ProjectRow) {
  const unsubscribers: Array<() => void> = [];
  const skipInitialStatusCheck = ['1', 'true'].includes(
    (c.req.query('fresh_start') ?? '').toLowerCase(),
  );

  return stream(c, async (s) => {
    c.header('Content-Type', 'application/x-ndjson');

    const cleanup = () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    };

    const closeStream = () => {
      cleanup();
      void s.close();
    };

    const childProjectCache = new Map<string, ProjectRow | null>();
    const deployState: DeployAgentState = {
      agentStarted: false,
      fallbackTriggered: false,
    };
    const fallbackTimerRef: FallbackTimerRef = {
      fallbackTimer: null,
    };
    const streamTimeoutRef: StreamTimeoutRef = {
      streamTimeout: null,
    };

    const resolveScopedProject = createScopedProjectResolver(project, ctx, childProjectCache);

    const write = (data: TimelineEvent) => {
      void s.write(
        JSON.stringify({
          ...data,
          timestamp: data.timestamp ?? new Date().toISOString(),
        }) + '\n',
      );
    };

    const emitTimelineEvent = (data: TimelineEvent) => {
      const eventId = data.id ?? nanoid(16);
      const eventTimestamp = data.timestamp ?? new Date().toISOString();

      ctx.db.createTimelineEvent({
        id: eventId,
        projectId: data.projectId,
        deployId: data.deployId,
        type: data.type,
        message: data.message,
        detail: typeof data.detail === 'string' ? data.detail : undefined,
        severity: data.severity,
        percent: data.percent,
        toolName: data.toolName,
        actionButtons:
          data.actionButtons || data.tokenCount !== undefined || data.costUsd !== undefined
            ? JSON.stringify({
                buttons: data.actionButtons,
                tokenCount: data.tokenCount,
                costUsd: data.costUsd,
              })
            : undefined,
        createdAt: eventTimestamp,
      });

      write({
        ...data,
        id: eventId,
        timestamp: eventTimestamp,
      });
    };

    const clearStreamTimeout = () => {
      if (streamTimeoutRef.streamTimeout) {
        clearTimeout(streamTimeoutRef.streamTimeout);
        streamTimeoutRef.streamTimeout = null;
      }
    };

    const handlerCtx: StreamHandlerContext = {
      project,
      ctx,
      write,
      emitTimelineEvent,
      resolveScopedProject,
      deployState,
      fallbackTimerRef,
      clearStreamTimeout,
      closeStream,
    };

    unsubscribers.push(...registerDeployLifecycleHandlers(handlerCtx));
    unsubscribers.push(...registerBuildEventHandlers(handlerCtx));
    unsubscribers.push(...registerComposeEventHandlers(handlerCtx));
    unsubscribers.push(...registerRecoveryEventHandlers(handlerCtx));

    streamTimeoutRef.streamTimeout = setTimeout(
      () => {
        closeStream();
      },
      5 * 60 * 1000,
    );

    fallbackTimerRef.fallbackTimer = setTimeout(() => {
      if (!deployState.agentStarted && !deployState.fallbackTriggered) {
        deployState.fallbackTriggered = true;
      }
    }, 5000);

    s.onAbort(() => {
      if (fallbackTimerRef.fallbackTimer) {
        clearTimeout(fallbackTimerRef.fallbackTimer);
        fallbackTimerRef.fallbackTimer = null;
      }
      clearStreamTimeout();
      cleanup();
    });

    if (skipInitialStatusCheck) {
      write({
        id: 'fresh-start',
        type: 'status',
        message: 'Preparing new deploy...',
        projectId: project.id,
      });
    } else if (handleInitialStatusCheck(ctx, project, write, closeStream)) {
      return;
    }

    await new Promise(() => undefined);
  });
}

interface ParsedActionButtons {
  buttons?: unknown[];
  tokenCount?: number;
  costUsd?: number | null;
}

function parseActionButtons(raw: string | null | undefined): ParsedActionButtons {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ParsedActionButtons;
    }
    return {};
  } catch {
    return {};
  }
}

export function registerDeployTimelineStreamRoutes(api: Hono, ctx: AppContext): void {
  api.get('/projects/:id/timeline', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const events = ctx.db.getTimelineEvents(project.id).reverse();

    return c.json({
      events: events.map((event) => {
        const parsedButtons = parseActionButtons(event.action_buttons);
        return {
          id: event.id,
          type: event.type,
          message: event.message,
          detail: event.detail,
          severity: event.severity,
          percent: event.percent,
          toolName: event.tool_name,
          actionButtons: parsedButtons.buttons,
          tokenCount: parsedButtons.tokenCount,
          costUsd: parsedButtons.costUsd,
          projectId: event.project_id,
          timestamp: event.created_at,
        };
      }),
    });
  });

  api.get('/projects/:id/build/stream', (c) => {
    const project = getProjectOrThrow(c, ctx);

    return handleBuildStreamRoute(c, ctx, project);
  });
}
