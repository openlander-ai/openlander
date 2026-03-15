import { Hono } from 'hono';
import { rm } from 'node:fs/promises';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { PreflightCheckError, ProjectNotFoundError } from '../../errors.js';
import { eventBus, type EventPayload } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { extractProjectName } from '../../pipeline/helpers.js';
import { preflightCheckOrThrow } from '../../pipeline/preflight.js';
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

function sanitizeToolResultForStream(value: unknown): unknown {
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

export function createDeployStreamRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/builds/:id/progress', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const unsubscribers: Array<() => void> = [];

    return stream(c, async (s) => {
      c.header('Content-Type', 'application/x-ndjson');

      unsubscribers.push(
        eventBus.on('deploy:start', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(JSON.stringify({ percent: 0, step: 'Starting deployment...' }) + '\n');
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(JSON.stringify({ percent: 25, step: 'Cloning repository...' }) + '\n');
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(JSON.stringify({ percent: 60, step: 'Building Docker image...' }) + '\n');
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(JSON.stringify({ percent: 90, step: 'Starting container...' }) + '\n');
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(JSON.stringify({ percent: 100, step: 'Complete' }) + '\n');
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({ percent: -1, step: 'Failed', error: payload.error }) + '\n',
          );
          void s.close();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:needs-user-action', (payload) => {
          if (payload.projectId !== project.id) return;
          void s.write(
            JSON.stringify({
              percent: -1,
              step: 'User action required',
              error: payload.title,
              detail: payload.description,
              userSteps: payload.userSteps,
            }) + '\n',
          );
          void s.close();
        }),
      );

      s.onAbort(() => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      });

      await Promise.resolve();
    });
  });

  api.post('/projects/deploy', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch?: string;
      name?: string;
      env_vars?: Record<string, string>;
      visibility?: 'internal' | 'quick-share';
      environment?: string;
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    // Fallback: no agent (LLM not configured) → direct pipeline call
    if (!ctx.agent) {
      const result = await ctx.pipeline.deploy({
        repoUrl: body.repo_url,
        branch: body.branch,
        name: body.name,
        envVars: body.env_vars,
        visibility: body.visibility,
        sshKeyPath: ctx.config.git.sshKeyPath || undefined,
        trigger: 'api',
        environment: body.environment,
      });
      return c.json(result, result.success ? 200 : 500);
    }

    const projectName = body.name ?? extractProjectName(body.repo_url);

    try {
      await preflightCheckOrThrow(ctx.db, ctx.docker, projectName);
    } catch (err) {
      if (err instanceof PreflightCheckError) {
        return c.json(
          {
            success: false,
            status: 'preflight_failed',
            error: err.message,
            preflightWarnings: err.result.warnings,
          },
          400,
        );
      }
      throw err;
    }

    const existing = ctx.db.getProjectByName(projectName);
    const projectId = existing?.id ?? nanoid(12);

    if (!existing) {
      const isNonProductionEnv = body.environment && body.environment !== 'production';
      ctx.db.createProject({
        id: projectId,
        name: projectName,
        repoUrl: body.repo_url,
        branch: isNonProductionEnv ? undefined : body.branch,
      });
    }

    ctx.db.updateProject(projectId, { status: 'building' });
    ctx.jobManager.trackJob(projectId, projectName);
    ctx.questionBridge.setActiveProject(projectId);

    if (body.env_vars && typeof body.env_vars === 'object') {
      for (const [key, value] of Object.entries(body.env_vars)) {
        if (typeof value === 'string' && value.trim()) {
          ctx.env.set(projectId, key, value.trim());
        }
      }
    }

    const message = `Deploy ${body.repo_url}${body.branch ? ` branch ${body.branch}` : ''}${body.name ? ` as ${body.name}` : ''}`;
    const sessionId = nanoid(12);

    const emitAgentEvent = async (event: EventPayload['agent:event']['event']) => {
      await eventBus.emit('agent:event', { projectId, event });
    };

    void (async () => {
      const deployState = {
        agentStarted: false,
        deployToolCalled: false,
        fallbackTriggered: false,
      };

      // Emit progress so user sees activity before agent responds
      await emitAgentEvent({
        type: 'message',
        content: 'Acquiring deploy slot...',
        timestamp: new Date().toISOString(),
      });
      const release = await ctx.deployQueue.acquire();
      await emitAgentEvent({
        type: 'message',
        content: 'Analyzing project and preparing deployment...',
        timestamp: new Date().toISOString(),
      });
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const runFallbackDeploy = async (reason: string) => {
        log.warn({ projectId, reason }, 'Falling back to direct deploy');

        await emitAgentEvent({
          type: 'message',
          content: 'Agent did not start deploy. Falling back to direct pipeline deploy.',
          timestamp: new Date().toISOString(),
        });

        try {
          await ctx.pipeline.deploy({
            repoUrl: body.repo_url,
            branch: body.branch,
            name: projectName,
            envVars: body.env_vars,
            visibility: body.visibility,
            sshKeyPath: ctx.config.git.sshKeyPath || undefined,
            trigger: 'api',
            environment: body.environment,
            _projectId: projectId,
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error({ err, projectId }, 'Fallback deploy failed');
          await emitAgentEvent({
            type: 'error',
            error: errMsg,
            timestamp: new Date().toISOString(),
          });
        }
      };

      try {
        fallbackTimer = setTimeout(() => {
          if (!deployState.agentStarted && !deployState.fallbackTriggered) {
            deployState.fallbackTriggered = true;
            void runFallbackDeploy('timeout');
          }
        }, 5000);

        const agent = ctx.agent;
        if (!agent) {
          throw new Error('Agent is null');
        }

        await emitAgentEvent({
          type: 'message',
          content: 'Agent is reasoning about deployment strategy...',
          timestamp: new Date().toISOString(),
        });

        await agent.chatStream(
          message,
          async (event) => {
            if (
              event.type === 'tool_call' ||
              event.type === 'question' ||
              event.type === 'message'
            ) {
              deployState.agentStarted = true;
            }

            if (event.type === 'tool_call' && event.toolName === 'deploy_project') {
              deployState.deployToolCalled = true;
            }

            await emitAgentEvent({
              ...event,
              timestamp: new Date().toISOString(),
            });
          },
          sessionId,
        );

        if (!deployState.deployToolCalled && !deployState.fallbackTriggered) {
          deployState.fallbackTriggered = true;
          await runFallbackDeploy('agent_completed_without_deploy_project');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error({ err, projectId }, 'Agent chatStream failed during deploy');

        await emitAgentEvent({
          type: 'error',
          error: errMsg,
          timestamp: new Date().toISOString(),
        });
      } finally {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
        }
        release();
      }
    })();

    return c.json({ success: true, projectId, projectName, status: 'building' });
  });

  api.post('/deploy/start', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch?: string;
      name?: string;
      environment?: string;
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    const result = await ctx.pipeline.startDeploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      name: body.name,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
      trigger: 'api',
      environment: body.environment,
    });

    return c.json(result, 200);
  });

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
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: 'Starting deployment...',
            projectId: project.id,
            percent: 0,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Cloning repository (${payload.commitSha.slice(0, 7)})`,
            projectId: project.id,
            percent: 25,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Docker image built (${String(Math.round(payload.durationMs / 1000))}s)`,
            projectId: project.id,
            percent: 60,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'status',
            message: `Starting container on port ${String(payload.port)}`,
            projectId: project.id,
            percent: 90,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:success', (payload) => {
          if (payload.projectId !== project.id) return;

          // Generate post-deploy insights before sending complete event
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

              // Send each insight as an NDJSON event
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

            // Send complete event and close stream
            emitTimelineEvent({
              type: 'complete',
              message: `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
              projectId: project.id,
              percent: 100,
            });
            clearTimeout(streamTimeout);
            cleanup();
            void s.close();
          })();
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:failed', (payload) => {
          if (payload.projectId !== project.id) return;
          emitTimelineEvent({
            type: 'error',
            message: `Deploy failed at ${payload.step}: ${payload.error}`,
            detail: payload.buildLog ?? null,
            projectId: project.id,
            percent: -1,
          });
          // Do NOT close stream — auto-recovery may follow
        }),
      );

      // Build recovery events → show autofix/suggestion in timeline
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

      // Dockerfile fix events → dockerfile_fixed in NDJSON stream
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

      // Compose lifecycle events
      unsubscribers.push(
        eventBus.on('compose:start', (payload) => {
          if (payload.projectId !== project.id) return;
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
          emitTimelineEvent({
            type: 'error',
            message: `Compose deploy failed: ${payload.error}`,
            projectId: project.id,
          });
          // Do NOT close stream — auto-recovery may follow
        }),
      );

      unsubscribers.push(
        eventBus.on('agent:event', (payload) => {
          if (payload.projectId !== project.id) return;
          const ev = payload.event;
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
            case 'error':
              emitTimelineEvent({ ...base, type: 'error', message: ev.error || 'Agent error' });
              break;
            default:
              emitTimelineEvent({ ...base, type: 'status', message: `Agent: ${ev.type}` });
          }
        }),
      );

      // Agent question events → question_pending in NDJSON stream
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
          if (payload.projectId !== project.id) return;
          write({ type: 'log', message: payload.line, projectId: project.id });
        }),
      );

      // Auto-close stream after 5 min timeout (safety net for auto-recovery)
      const streamTimeout = setTimeout(
        () => {
          cleanup();
          void s.close();
        },
        5 * 60 * 1000,
      );

      s.onAbort(() => {
        clearTimeout(streamTimeout);
        cleanup();
      });

      // Emit initial status based on current project state (handles race with deploy:start)
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

      // Keep stream alive — event handlers call s.close() on completion
      await new Promise(() => {
        /* never resolves — closed by event handlers or abort */
      });
    });
  });

  // POST /api/env/scan — scan a repo for env var usage (initial deploy)
  api.post('/env/scan', async (c) => {
    const body = await c.req.json<{ repo_url: string; branch?: string }>();
    if (!body.repo_url) {
      return c.json({ error: 'repo_url is required' }, 400);
    }

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({ repoUrl: body.repo_url, branch: body.branch });
      clonePath = cloneResult.path;
      const result = scanForEnvUsage(clonePath);
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  // POST /api/projects/:id/env/scan — scan existing project repo (redeploy)
  api.post('/projects/:id/env/scan', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (!project.repo_url) return c.json({ error: 'Project has no repo URL' }, 400);

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({ repoUrl: project.repo_url, branch: project.branch });
      clonePath = cloneResult.path;
      const result = scanForEnvUsage(clonePath);

      const allStoredKeys = new Set<string>();
      for (const key of Object.keys(ctx.env.getAll(project.id))) allStoredKeys.add(key);
      for (const key of Object.keys(ctx.env.getGlobalSecrets())) allStoredKeys.add(key);
      for (const env of ctx.db.getEnvironmentsByProject(project.id)) {
        for (const key of Object.keys(ctx.env.getAll(project.id, env.id))) allStoredKeys.add(key);
      }
      const newVars = result.vars.filter((v) => !allStoredKeys.has(v.key));
      const existingVars = result.vars.filter((v) => allStoredKeys.has(v.key)).map((v) => v.key);

      return c.json({
        vars: result.vars,
        newVars,
        existingVars,
        hasEnvExample: result.hasEnvExample,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    } finally {
      if (clonePath) await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  return api;
}
