import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import type { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { ProjectRow } from '../../db/types.js';
import { ProjectNotFoundError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { generatePostDeployInsights } from '../../pipeline/post-deploy-insight.js';

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

export function registerDeployTimelineStreamRoutes(api: Hono, ctx: AppContext): void {
  api.get('/projects/:id/timeline', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const events = ctx.db.getTimelineEvents(project.id).reverse();

    return c.json({
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        message: event.message,
        detail: event.detail,
        severity: event.severity,
        percent: event.percent,
        toolName: event.tool_name,
        actionButtons: (() => {
          if (!event.action_buttons) return undefined;
          try {
            return JSON.parse(event.action_buttons) as unknown;
          } catch (err) {
            void err;
            return undefined;
          }
        })(),
        projectId: event.project_id,
        timestamp: event.created_at,
      })),
    });
  });

  api.get('/projects/:id/build/stream', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const unsubscribers: Array<() => void> = [];

    return stream(c, async (s) => {
      c.header('Content-Type', 'application/x-ndjson');

      const cleanup = () => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      };

      const childProjectCache = new Map<string, ProjectRow | null>();
      const deployState = {
        agentStarted: false,
        fallbackTriggered: false,
      };
      const fallbackTimerRef: FallbackTimerRef = {
        fallbackTimer: null,
      };

      const resolveScopedProject = (
        sourceProjectId: string,
        explicitScope?: unknown,
        explicitParentProjectId?: unknown,
      ): { scope: string; sourceProjectId: string; isChild: boolean } | null => {
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

      const write = (data: {
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
        [key: string]: unknown;
      }) => {
        void s.write(
          JSON.stringify({
            ...data,
            timestamp: data.timestamp ?? new Date().toISOString(),
          }) + '\n',
        );
      };

      const emitTimelineEvent = (data: {
        id?: string;
        type: string;
        message: string;
        projectId: string;
        timestamp?: string;
        detail?: string | null;
        severity?: 'info' | 'warning' | 'error';
        percent?: number;
        toolName?: string;
        actionButtons?: unknown;
        deployId?: string;
        [key: string]: unknown;
      }) => {
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
          actionButtons: data.actionButtons ? JSON.stringify(data.actionButtons) : undefined,
          createdAt: eventTimestamp,
        });

        write({
          ...data,
          id: eventId,
          timestamp: eventTimestamp,
        });
      };

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

      unsubscribers.push(
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
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
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
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
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
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            durationMs: payload.durationMs,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
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
            phase: payload.phase,
            scope: scoped.scope,
            status: payload.status,
            sourceProjectId: scoped.sourceProjectId,
          });
        }),
      );

      unsubscribers.push(
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

            emitTimelineEvent({
              type: 'complete',
              message:
                payload.message ??
                `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
              projectId: project.id,
              percent: 100,
              phase: payload.phase,
              scope: scoped.scope,
              status: payload.status,
              durationMs: payload.totalDurationMs,
              sourceProjectId: scoped.sourceProjectId,
            });
            clearTimeout(streamTimeout);
            cleanup();
            void s.close();
          })();
        }),
      );

      unsubscribers.push(
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
      );

      unsubscribers.push(
        eventBus.on('build:autofix', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Auto-fix applied: ${payload.action} (${payload.category})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:suggest', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Suggestion: ${payload.suggestion}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:inform', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Build analysis: ${payload.summary}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:dockerfile-fixed', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Dockerfile fixed (attempt ${String(payload.retryCount)}/3): ${payload.changes.join(', ')}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:needs-user-action', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'error',
            message: payload.title,
            detail: payload.description,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:start', (payload) => {
          if (payload.projectId !== project.id) return;
          deployState.fallbackTriggered = true;
          if (fallbackTimerRef.fallbackTimer) {
            clearTimeout(fallbackTimerRef.fallbackTimer);
            fallbackTimerRef.fallbackTimer = null;
          }
          emitTimelineEvent({
            type: 'status',
            message: `Compose build starting (${String(payload.serviceCount)} service${payload.serviceCount > 1 ? 's' : ''})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:up', (payload) => {
          if (payload.projectId !== project.id) return;
          deployState.fallbackTriggered = true;
          if (fallbackTimerRef.fallbackTimer) {
            clearTimeout(fallbackTimerRef.fallbackTimer);
            fallbackTimerRef.fallbackTimer = null;
          }
          emitTimelineEvent({
            type: 'complete',
            message: `Compose deploy complete — ${String(payload.services.length)} service${payload.services.length > 1 ? 's' : ''} running`,
            projectId: project.id,
          });
          cleanup();
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          deployState.fallbackTriggered = true;
          if (fallbackTimerRef.fallbackTimer) {
            clearTimeout(fallbackTimerRef.fallbackTimer);
            fallbackTimerRef.fallbackTimer = null;
          }
          emitTimelineEvent({
            type: 'error',
            message: `Compose deploy failed: ${payload.error}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('agent:event', (payload) => {
          if (payload.projectId !== project.id) return;
          if (shouldSuppressAgentEvent(deployState)) return;
          const ev = payload.event;
          markAgentStarted(deployState, ev.type, fallbackTimerRef);
          const base = { projectId: project.id, timestamp: ev.timestamp };

          switch (ev.type) {
            case 'thinking':
              emitTimelineEvent({
                ...base,
                type: 'agent_thinking',
                message: 'Agent is analyzing...',
              });
              break;
            case 'tool_call':
              emitTimelineEvent({
                ...base,
                type: 'agent_tool_call',
                message: `Calling ${ev.toolName}...`,
                toolName: ev.toolName,
                toolArguments: ev.arguments,
              });
              break;
            case 'tool_result':
              emitTimelineEvent({
                ...base,
                type: 'agent_tool_result',
                message: ev.success
                  ? `${ev.toolName} completed`
                  : `${ev.toolName} failed: ${ev.error ?? 'unknown'}`,
                toolName: ev.toolName,
                toolResult: ev.result === undefined ? null : sanitizeToolResultForStream(ev.result),
                toolSuccess: ev.success,
                toolError: ev.error ?? null,
              });
              break;
            case 'message':
              emitTimelineEvent({ ...base, type: 'agent_message', message: ev.content });
              break;
            case 'question':
              break;
            case 'error':
              emitTimelineEvent({ ...base, type: 'error', message: ev.error || 'Agent error' });
              break;
            default:
              emitTimelineEvent({ ...base, type: 'status', message: `Agent: ${ev.type}` });
          }
        }),
      );

      unsubscribers.push(
        eventBus.on('question:pending', (payload) => {
          if (payload.projectId !== project.id) return;
          const firstQuestion = payload.questions[0];
          emitTimelineEvent({
            id: payload.requestId,
            type: 'question_pending',
            message: firstQuestion?.question ?? 'Agent needs input',
            questionId: payload.requestId,
            questions: payload.questions,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
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
      );

      const streamTimeout = setTimeout(
        () => {
          cleanup();
          void s.close();
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
        clearTimeout(streamTimeout);
        cleanup();
      });

      const fresh = ctx.db.getProject(project.id);
      if (fresh) {
        if (fresh.status === 'running' || fresh.status === 'error' || fresh.status === 'stopped') {
          const lastDeploy = ctx.db.getLastDeployLog(project.id);
          if (lastDeploy) {
            const ago = formatRelativeTime(lastDeploy.created_at);
            const duration = lastDeploy.duration_ms
              ? `${String(Math.round(lastDeploy.duration_ms / 1000))}s`
              : '';
            const trigger = lastDeploy.trigger;
            const commitInfo = lastDeploy.commit_sha
              ? ` (${lastDeploy.commit_sha.slice(0, 7)})`
              : '';

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
            write({
              id: 'current-error',
              type: 'error',
              message: 'Build failed',
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
          cleanup();
          void s.close();
          return;
        }
        write({
          id: 'current-building',
          type: 'status',
          message: `Build in progress (${fresh.status})...`,
          projectId: project.id,
        });
      }

      await new Promise(() => undefined);
    });
  });
}
