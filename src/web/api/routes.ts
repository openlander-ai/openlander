import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { getSystemStats, formatStatsSummary } from '../../monitor/stats.js';
import { OpenLanderError, PreflightCheckError, ProjectNotFoundError } from '../../errors.js';
import { createGitProvider } from '../../git-providers/index.js';
import { loadConfig } from '../../config/index.js';
import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
import { SessionStore } from '../session.js';
import { createModuleLogger } from '../../lib/logger.js';
import {
  detectReverseProxy,
  getProxyStatus,
  getLanIp,
  getProjectUrl,
  getAllIps,
} from '../../pipeline/traefik.js';
import { extractProjectName } from '../../pipeline/helpers.js';
import { preflightCheckOrThrow } from '../../pipeline/preflight.js';
import { generatePostDeployInsights } from '../../pipeline/post-deploy-insight.js';
import { DeployQueue } from '../../agent/deploy-queue.js';

const log = createModuleLogger('api');
// --- Activity Event Buffer ---

interface ActivityEvent {
  type: string;
  project: string;
  user: string;
  status: string;
  detail?: string;
  time: string;
}

const activityBuffer: ActivityEvent[] = [];
const MAX_ACTIVITY = 100;

/**
 * REST API routes for OpenLander.
 *
 * All routes are prefixed with /api (mounted by server.ts).
 *
 * Endpoints:
 * - POST   /projects/deploy    — Deploy a new project
 * - GET    /projects            — List all projects
 * - GET    /projects/:id        — Get project details
 * - POST   /projects/:id/stop   — Stop a project
 * - POST   /projects/:id/redeploy — Redeploy a project
 * - POST   /projects/:id/rollback — Rollback to previous image (v0.3)
 * - POST   /projects/:id/blue-green — Blue-green deploy (v0.3)
 * - POST   /projects/:id/provision-db — Provision database sidecar (v0.3)
 * - POST   /projects/:id/debug-build — Debug build errors with AI (v0.3)
 * - DELETE /projects/:id        — Remove a project
 * - GET    /projects/:id/logs   — Get project logs
 * - GET    /projects/:id/env    — Get env vars (masked)
 * - POST   /projects/:id/env    — Set environment variables
 * - POST   /projects/:id/expose — Expose project publicly
 * - POST   /projects/:id/unexpose — Remove public URL
 * - GET    /secrets             — List all global secrets (masked)
 * - POST   /secrets             — Create or update a global secret
 * - DELETE /secrets/:key        — Delete a global secret
 * - GET    /system/stats        — System resource usage
 * - POST   /chat                — Send a chat message to the agent
 */
export function createApiRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // --- Error handler ---
  api.onError((err, c) => {
    if (err instanceof OpenLanderError) {
      return c.json(err.toJSON(), err.statusCode as 400);
    }
    log.error({ err }, 'API Error');
    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
  });

  // --- Session Store ---
  const sessionStore = new SessionStore(ctx.db);

  // --- Deploy Queue (sequential agent-mediated deploys) ---
  const deployQueue = new DeployQueue();

  // --- Event Subscription for Activity Buffer ---

  const eventToStatus: Partial<Record<EventType, string>> = {
    'deploy:start': 'building',
    'deploy:clone': 'cloning',
    'deploy:build': 'building',
    'deploy:run': 'starting',
    'deploy:success': 'running',
    'deploy:failed': 'error',
    'deploy:rollback': 'rolling-back',
    'container:start': 'running',
    'container:stop': 'stopped',
    'container:remove': 'removed',
    'container:health': 'health-check',
    'compose:start': 'building',
    'compose:up': 'running',
    'compose:failed': 'error',
    'tunnel:start': 'tunnel-starting',
    'tunnel:stop': 'tunnel-stopped',
    'tunnel:url': 'tunnel-active',
    'env:set': 'env-updated',
    'env:delete': 'env-deleted',
  };

  const eventTypes: EventType[] = [
    'deploy:start',
    'deploy:clone',
    'deploy:build',
    'deploy:run',
    'deploy:success',
    'deploy:failed',
    'deploy:rollback',
    'container:start',
    'container:stop',
    'container:remove',
    'container:health',
    'tunnel:start',
    'tunnel:stop',
    'tunnel:url',
    'env:set',
    'env:delete',
    'compose:start',
    'compose:up',
    'compose:failed',
  ];

  for (const eventType of eventTypes) {
    eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
      const projectId = (payload as { projectId?: string }).projectId;
      if (!projectId) return;

      const project = ctx.db.getProject(projectId);
      const projectName = project?.name ?? projectId;
      const status = eventToStatus[eventType] ?? 'unknown';

      const activityEvent: ActivityEvent = {
        type: eventType,
        project: projectName,
        user: 'system',
        status,
        time: new Date().toISOString(),
      };

      if (eventType === 'deploy:failed') {
        activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
      } else if (eventType === 'tunnel:url') {
        activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
      } else if (eventType === 'compose:failed') {
        activityEvent.detail = (payload as EventPayload['compose:failed']).error;
      }

      activityBuffer.push(activityEvent);
      if (activityBuffer.length > MAX_ACTIVITY) {
        activityBuffer.shift();
      }
    });
  }

  // Auto-release deploy locks on completion/failure
  eventBus.on('deploy:success', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('deploy:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:up', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });
  eventBus.on('compose:failed', (p) => {
    ctx.db.releaseDeployLock(p.projectId);
  });

  // --- Activity Streaming ---

  api.get('/activity', (c) => {
    const follow = c.req.query('follow');

    if (follow) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        const unsubscribers: Array<() => void> = [];
        for (const eventType of eventTypes) {
          unsubscribers.push(
            eventBus.on(eventType, (payload: EventPayload[typeof eventType]) => {
              const projectId = (payload as { projectId?: string }).projectId;
              if (!projectId) return;

              const project = ctx.db.getProject(projectId);
              const projectName = project?.name ?? projectId;
              const status = eventToStatus[eventType] ?? 'unknown';

              const activityEvent: ActivityEvent = {
                type: eventType,
                project: projectName,
                user: 'system',
                status,
                time: new Date().toISOString(),
              };

              if (eventType === 'deploy:failed') {
                activityEvent.detail = (payload as EventPayload['deploy:failed']).error;
              } else if (eventType === 'tunnel:url') {
                activityEvent.detail = (payload as EventPayload['tunnel:url']).url;
              }

              void s.write(JSON.stringify(activityEvent) + '\n');
            }),
          );
        }

        s.onAbort(() => {
          for (const unsub of unsubscribers) {
            unsub();
          }
        });

        await Promise.resolve();
      });
    }

    return c.json({ activities: activityBuffer.slice(-20) });
  });

  // --- Build Progress Streaming ---

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

      s.onAbort(() => {
        for (const unsub of unsubscribers) {
          unsub();
        }
      });

      await Promise.resolve();
    });
  });

  // --- Project Stats ---

  api.get('/projects/:id/stats', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    if (project.container_id && project.status === 'running') {
      try {
        const container = ctx.docker.getClient().getContainer(project.container_id);
        const stats = await container.stats({ stream: false });

        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent =
          systemDelta > 0
            ? (cpuDelta / systemDelta) * stats.cpu_stats.cpu_usage.percpu_usage.length * 100
            : 0;

        return c.json({
          cpu: Math.round(cpuPercent * 10) / 10,
          memory: stats.memory_stats.usage,
          memoryLimit: stats.memory_stats.limit,
          status: project.status,
        });
      } catch (err) {
        log.debug({ err, projectId: project.id }, 'Container stats fetch failed');
        return c.json({
          cpu: 0,
          memory: 0,
          memoryLimit: 0,
          status: project.status,
        });
      }
    }

    return c.json({
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      status: project.status,
    });
  });

  // --- Start Project ---

  api.post('/projects/:id/start', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    if (!project.container_id) {
      return c.json({ error: 'NO_CONTAINER', message: 'No container found. Use redeploy.' }, 400);
    }

    const container = ctx.docker.getClient().getContainer(project.container_id);
    await container.start();

    ctx.db.updateProject(project.id, { status: 'running' });

    void eventBus.emit('container:start', {
      projectId: project.id,
      containerId: project.container_id,
    });

    return c.json({ status: 'started', project: project.name });
  });

  // --- Session Management ---

  api.get('/sessions', (c) => {
    const sessions = sessionStore.listSessions();
    return c.json({ sessions });
  });

  api.get('/sessions/:id/messages', (c) => {
    const sessionId = c.req.param('id');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit') ?? '50', 10) : undefined;
    const messages = sessionStore.getMessages(sessionId, limit);
    return c.json({ messages });
  });

  // --- Global Secrets ---

  api.get('/secrets', (c) => {
    const secrets = ctx.env.getGlobalSecretsMasked();
    return c.json({ secrets });
  });

  api.post('/secrets', async (c) => {
    const body = await c.req.json<{ key: string; value: string; description?: string }>();
    if (!body.key || !body.value) {
      return c.json({ error: 'MISSING_FIELD', message: 'key and value are required' }, 400);
    }
    ctx.env.setGlobalSecret(body.key, body.value, body.description);
    return c.json({ status: 'saved', key: body.key });
  });

  api.delete('/secrets/:key', (c) => {
    const key = c.req.param('key');
    const deleted = ctx.env.deleteGlobalSecret(key);
    if (!deleted) {
      return c.json({ error: 'NOT_FOUND', message: `Secret "${key}" not found` }, 404);
    }
    return c.json({ status: 'deleted', key });
  });

  // --- Projects ---

  api.post('/projects/deploy', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch?: string;
      name?: string;
      env_vars?: Record<string, string>;
      visibility?: 'internal' | 'quick-share';
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
      ctx.db.createProject({
        id: projectId,
        name: projectName,
        repoUrl: body.repo_url,
        branch: body.branch,
      });
    }

    ctx.db.updateProject(projectId, { status: 'building' });
    ctx.jobManager.trackJob(projectId, projectName);
    ctx.questionBridge.setActiveProject(projectId);

    const message = `Deploy ${body.repo_url}${body.branch ? ` branch ${body.branch}` : ''}${body.name ? ` as ${body.name}` : ''}`;
    const sessionId = nanoid(12);

    const emitAgentEvent = async (event: EventPayload['agent:event']['event']) => {
      await eventBus.emit('agent:event', { projectId, event });
    };

    void (async () => {
      const deployState = { toolCalled: false, fallbackTriggered: false };

      // Emit progress so user sees activity before agent responds
      await emitAgentEvent({
        type: 'message',
        content: 'Acquiring deploy slot...',
        timestamp: new Date().toISOString(),
      });
      const release = await deployQueue.acquire();
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
          if (!deployState.toolCalled && !deployState.fallbackTriggered) {
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
            if (event.type === 'tool_call' && event.toolName === 'deploy_project') {
              deployState.toolCalled = true;
            }

            await emitAgentEvent({
              ...event,
              timestamp: new Date().toISOString(),
            });
          },
          sessionId,
        );

        if (!deployState.toolCalled && !deployState.fallbackTriggered) {
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
    }>();

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    const result = ctx.pipeline.startDeploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      name: body.name,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
      trigger: 'api',
    });

    return c.json(result, 200);
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
        timestamp?: string;
        [key: string]: unknown;
      }) => {
        void s.write(
          JSON.stringify({
            ...data,
            timestamp: data.timestamp ?? new Date().toISOString(),
          }) + '\n',
        );
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
          write({ type: 'status', message: 'Starting deployment...', projectId: project.id });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:clone', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Cloning repository (${payload.commitSha.slice(0, 7)})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:build', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Docker image built (${String(Math.round(payload.durationMs / 1000))}s)`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('deploy:run', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Starting container on port ${String(payload.port)}`,
            projectId: project.id,
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
              );

              // Send each insight as an NDJSON event
              for (const insight of insights) {
                void s.write(
                  JSON.stringify({
                    type: 'insight',
                    message: insight.title,
                    detail: insight.detail ?? null,
                    severity: insight.severity,
                    actionButtons: insight.actions.length > 0 ? insight.actions : undefined,
                    projectId: project.id,
                    timestamp: new Date().toISOString(),
                  }) + '\n',
                );
              }
            } catch (err) {
              log.warn({ err }, 'Post-deploy insight generation failed');
            }

            // Send complete event and close stream
            write({
              type: 'complete',
              message: `Deploy complete in ${String(Math.round(payload.totalDurationMs / 1000))}s — ${payload.url}`,
              projectId: project.id,
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
          write({
            type: 'error',
            message: `Deploy failed at ${payload.step}: ${payload.error}`,
            projectId: project.id,
          });
          // Do NOT close stream — auto-recovery may follow
        }),
      );

      // Build recovery events → show autofix/suggestion in timeline
      unsubscribers.push(
        eventBus.on('build:autofix', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Auto-fix applied: ${payload.action} (${payload.category})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:suggest', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Suggestion: ${payload.suggestion}`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('build:inform', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
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
          write({
            type: 'status',
            message: `Dockerfile fixed (attempt ${String(payload.retryCount)}/3): ${payload.changes.join(', ')}`,
            projectId: project.id,
          });
        }),
      );

      // Compose lifecycle events
      unsubscribers.push(
        eventBus.on('compose:start', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
            type: 'status',
            message: `Compose build starting (${String(payload.serviceCount)} service${payload.serviceCount > 1 ? 's' : ''})`,
            projectId: project.id,
          });
        }),
      );

      unsubscribers.push(
        eventBus.on('compose:up', (payload) => {
          if (payload.projectId !== project.id) return;
          write({
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
          write({
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
              write({ ...base, type: 'agent_thinking', message: 'Agent is analyzing...' });
              break;
            case 'tool_call':
              write({
                ...base,
                type: 'agent_tool_call',
                message: `Calling ${ev.toolName}...`,
                toolName: ev.toolName,
                toolArguments: ev.arguments,
              });
              break;
            case 'tool_result':
              write({
                ...base,
                type: ev.success ? 'status' : 'error',
                message: ev.success
                  ? `${ev.toolName} completed`
                  : `${ev.toolName} failed: ${ev.error ?? 'unknown'}`,
              });
              break;
            case 'message':
              write({ ...base, type: 'agent_message', message: ev.content });
              break;
            case 'error':
              write({ ...base, type: 'error', message: ev.error || 'Agent error' });
              break;
            default:
              write({ ...base, type: 'status', message: `Agent: ${ev.type}` });
          }
        }),
      );

      // Agent question events → question_pending in NDJSON stream
      unsubscribers.push(
        eventBus.on('question:pending', (payload) => {
          if (payload.projectId !== project.id) return;
          const firstQuestion = payload.questions[0];
          void s.write(
            JSON.stringify({
              type: 'question_pending',
              message: firstQuestion?.question ?? 'Agent needs input',
              questionId: payload.requestId,
              questions: payload.questions,
              projectId: project.id,
              timestamp: new Date().toISOString(),
            }) + '\n',
          );
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
              type: 'status',
              message: `Last deploy: ${trigger}${commitInfo} — ${ago}${duration ? `, took ${duration}` : ''}`,
              projectId: project.id,
            });
          }

          if (fresh.status === 'running') {
            write({ type: 'complete', message: 'Currently running', projectId: project.id });
          } else if (fresh.status === 'error') {
            write({ type: 'error', message: 'Build failed', projectId: project.id });
          } else {
            write({ type: 'status', message: 'Stopped', projectId: project.id });
          }
          cleanup();
          void s.close();
          return;
        }
        write({
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

  api.get('/projects', (c) => {
    const status = c.req.query('status') as
      | 'running'
      | 'stopped'
      | 'building'
      | 'error'
      | undefined;
    const projects = ctx.db.listProjects(status);

    return c.json({
      count: projects.length,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        visibility: p.visibility,
        repoUrl: p.repo_url,
        branch: p.branch,
        port: p.assigned_port,
        url: p.assigned_port ? getProjectUrl(p.name) : null,
        publicUrl: p.public_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        parentProjectId: p.parent_project_id,
        isCompose: ctx.db.isParentProject(p.id),
        serviceCount: ctx.db.getChildProjects(p.id).length,
      })),
    });
  });

  api.get('/projects/:id', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const envVars = ctx.env.getAllMasked(project.id);
    const deployLogs = ctx.db.getDeployLogs(project.id, 5);

    return c.json({
      ...project,
      url: project.assigned_port ? getProjectUrl(project.name) : null,
      envVars,
      recentDeploys: deployLogs,
    });
  });

  // --- Deployment History ---

  api.get('/projects/:id/deployments', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const logs = ctx.db.getDeployLogs(project.id, limit);

    return c.json({
      count: logs.length,
      deployments: logs.map((log) => ({
        id: log.id,
        status: log.status,
        trigger: log.trigger,
        commitSha: log.commit_sha,
        durationMs: log.duration_ms,
        createdAt: log.created_at,
      })),
    });
  });

  api.get('/projects/:id/deployments/:deployId', (c) => {
    const id = c.req.param('id');
    const deployId = c.req.param('deployId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const log = ctx.db.getDeployLog(deployId);
    if (!log || log.project_id !== project.id) {
      return c.json({ error: 'NOT_FOUND', message: 'Deployment not found' }, 404);
    }

    return c.json({
      id: log.id,
      projectId: log.project_id,
      status: log.status,
      trigger: log.trigger,
      commitSha: log.commit_sha,
      buildLog: log.build_log,
      durationMs: log.duration_ms,
      createdAt: log.created_at,
    });
  });

  api.post('/projects/:id/stop', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    await ctx.pipeline.stop(project.id);
    return c.json({ status: 'stopped', project: project.name });
  });

  api.post('/projects/:id/redeploy', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    // Mark project as building so build/stream sees fresh state
    ctx.db.updateProject(project.id, { status: 'building' });

    // Redeploy is deterministic — no LLM needed. Direct pipeline call.
    try {
      const result = await ctx.pipeline.redeploy(project.id);
      return c.json(result, result.success ? 200 : 500);
    } catch (err) {
      // Ensure status is reset on unexpected error
      ctx.db.updateProject(project.id, { status: 'error' });
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    }
  });

  // v0.3: Rollback
  api.post('/projects/:id/rollback', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const result = await ctx.pipeline.rollback(project.id);
    return c.json(result, result.success ? 200 : 500);
  });

  // v0.3: Blue-green deployment
  api.post('/projects/:id/blue-green', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req
      .json<{ health_check_path?: string }>()
      .catch((): { health_check_path?: string } => ({}));
    const result = await ctx.blueGreen.deploy(project.id, {
      healthCheckPath: body.health_check_path,
    });
    return c.json(result, result.success ? 200 : 500);
  });

  // v0.3: Database provisioning
  api.post('/projects/:id/provision-db', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req
      .json<{ type?: 'sqlite' | 'postgres'; db_name?: string }>()
      .catch((): { type?: 'sqlite' | 'postgres'; db_name?: string } => ({}));
    const result = await ctx.dbProvisioner.provision(project.id, {
      type: body.type ?? 'postgres',
      dbName: body.db_name,
    });
    return c.json({ status: 'provisioned', project: project.name, ...result });
  });

  // v0.3: Build error debugging
  api.post('/projects/:id/debug-build', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    if (!ctx.buildDebugger) {
      return c.json(
        { error: 'LLM_NOT_CONFIGURED', message: 'Build debugger requires an LLM provider.' },
        400,
      );
    }

    const lastDeploy = ctx.db.getLastDeployLog(project.id);
    if (!lastDeploy || lastDeploy.status !== 'failed') {
      return c.json(
        { error: 'NO_FAILED_BUILD', message: 'No failed build found for this project.' },
        404,
      );
    }

    const diagnosis = await ctx.buildDebugger.diagnose({
      buildLog: lastDeploy.build_log ?? 'No build log available',
      projectName: project.name,
      imageTag: project.image_tag ?? `openlander/${project.name}:latest`,
      failedStep: 'build',
    });
    return c.json(diagnosis);
  });

  // v0.4: Preview deployments
  api.post('/previews/deploy', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch: string;
      project_id?: string;
      ttl_ms?: number;
    }>();
    if (!body.repo_url || !body.branch) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url and branch are required' }, 400);
    }
    const result = await ctx.previewDeployer.deploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      projectId: body.project_id,
      ttlMs: body.ttl_ms,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
    });
    return c.json(result, result.success ? 200 : 500);
  });

  api.get('/previews', (c) => {
    const previews = ctx.previewDeployer.list();
    return c.json({
      count: previews.length,
      previews: previews.map((p) => ({
        branch: p.branch,
        url: p.url,
        port: p.port,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  api.delete('/previews/:id', async (c) => {
    const previewId = c.req.param('id');
    await ctx.previewDeployer.cleanup(previewId);
    return c.json({ status: 'cleaned_up', previewId });
  });

  // --- v0.0.11: Insight action handlers ---

  api.post('/projects/:id/actions', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req.json<{ action: string }>();
    const { action } = body;

    switch (action) {
      case 'cleanup_stale': {
        // Remove old containers for this project (keep the current one)
        const managed = await ctx.docker.listManagedContainers();
        const stale = managed.filter(
          (c) =>
            c.name.startsWith(project.name) &&
            c.id !== project.container_id &&
            c.status === 'running',
        );
        const client = ctx.docker.getClient();
        for (const container of stale) {
          try {
            const dockerContainer = client.getContainer(container.id);
            await dockerContainer.stop();
            await dockerContainer.remove();
          } catch (err) {
            log.warn({ err, containerId: container.id }, 'Failed to remove stale container');
          }
        }
        return c.json({ status: 'ok', action, removed: stale.length });
      }

      case 'view_logs': {
        // Return a redirect hint — frontend navigates to logs tab
        return c.json({ status: 'ok', action, redirect: 'logs' });
      }

      case 'retry_healthcheck': {
        const result = await ctx.healthMonitor.checkProject(project.id);
        return c.json({
          status: 'ok',
          action,
          healthy: result.healthy,
          responseTimeMs: result.responseTimeMs,
        });
      }

      default:
        return c.json({ status: 'error', message: `Unknown action: ${action}` }, 400);
    }
  });

  api.delete('/projects/:id', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    await ctx.pipeline.remove(project.id);
    return c.json({ status: 'removed', project: project.name });
  });

  api.get('/projects/:id/logs', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const follow = c.req.query('follow');

    if (follow && project.container_id) {
      const containerId = project.container_id;
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        try {
          const container = ctx.docker.getClient().getContainer(containerId);
          const logStream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 50,
          });

          logStream.on('data', (chunk: Buffer) => {
            const headerSize = 8;
            const streamType = chunk[0] === 1 ? 'stdout' : 'stderr';
            const line = chunk.subarray(headerSize).toString('utf8').trim();

            if (line) {
              const logEntry = {
                line,
                stream: streamType,
                time: new Date().toISOString(),
              };
              void s.write(JSON.stringify(logEntry) + '\n');
            }
          });

          logStream.on('end', () => {
            void s.close();
          });

          logStream.on('error', () => {
            void s.close();
          });

          s.onAbort(() => {
            // Stream will be cleaned up automatically on abort
          });
        } catch (err) {
          log.debug({ err, projectId: project.id }, 'Log streaming failed');
          void s.write(JSON.stringify({ error: 'Failed to stream logs' }) + '\n');
          void s.close();
        }
      });
    }

    const lines = parseInt(c.req.query('lines') ?? '50', 10);
    const logs = await ctx.pipeline.getLogs(project.id, lines);
    return c.json({ project: project.name, logs });
  });

  api.get('/projects/:id/env', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const vars = ctx.env.getAllMasked(project.id);
    return c.json({ project: project.name, envVars: vars });
  });

  api.post('/projects/:id/env', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = ctx.env.setBulk(project.id, body.variables);
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      keys: Object.keys(body.variables),
      needsRedeploy: changed && project.status === 'running',
    });
  });

  api.post('/question/reply', async (c) => {
    const body = await c.req
      .json<{
        request_id?: unknown;
        requestId?: unknown;
        answers?: Array<{
          questionIndex?: unknown;
          selectedLabels?: unknown;
          customText?: unknown;
        }>;
      }>()
      .catch(() => ({
        request_id: undefined,
        requestId: undefined,
        answers: undefined,
      }));

    const requestId = body.request_id || body.requestId;
    if (typeof requestId !== 'string' || requestId.trim() === '') {
      return c.json({ error: 'MISSING_FIELD', message: 'request_id is required' }, 400);
    }

    const answers = body.answers;

    if (!Array.isArray(answers)) {
      return c.json({ error: 'MISSING_FIELD', message: 'answers array is required' }, 400);
    }

    for (const answer of answers) {
      if (typeof answer !== 'object') {
        return c.json({ error: 'INVALID_ANSWER', message: 'Each answer must be an object' }, 400);
      }

      const normalized = answer as {
        questionIndex?: unknown;
        selectedLabels?: unknown;
        customText?: unknown;
      };

      const isValidQuestionIndex =
        typeof normalized.questionIndex === 'number' &&
        Number.isInteger(normalized.questionIndex) &&
        normalized.questionIndex >= 0;
      const isValidSelectedLabels =
        Array.isArray(normalized.selectedLabels) &&
        normalized.selectedLabels.every((value) => typeof value === 'string');
      const isValidCustomText =
        normalized.customText === undefined || typeof normalized.customText === 'string';

      if (!isValidQuestionIndex || !isValidSelectedLabels || !isValidCustomText) {
        return c.json(
          {
            error: 'INVALID_ANSWER',
            message:
              'Each answer must include questionIndex, selectedLabels, and optional customText',
          },
          400,
        );
      }
    }

    if (!ctx.questionBridge.hasPending()) {
      return c.json(
        { error: 'NO_PENDING_QUESTION', message: 'No pending question to answer' },
        409,
      );
    }

    const normalizedAnswers = answers.map((answer) => {
      const normalized = answer as {
        questionIndex: number;
        selectedLabels: string[];
        customText?: string;
      };

      return {
        questionIndex: normalized.questionIndex,
        selectedLabels: normalized.selectedLabels,
        customText: normalized.customText,
      };
    });

    ctx.questionBridge.reply(requestId, normalizedAnswers);

    return c.json({ status: 'answered' });
  });

  api.post('/question/dismiss', async (c) => {
    await c.req
      .json<{ request_id?: string; requestId?: string }>()
      .catch(() => ({ request_id: undefined, requestId: undefined }));

    if (!ctx.questionBridge.hasPending()) {
      return c.json(
        { error: 'NO_PENDING_QUESTION', message: 'No pending question to dismiss' },
        409,
      );
    }

    ctx.questionBridge.reject();
    return c.json({ status: 'dismissed' });
  });

  api.post('/projects/:id/expose', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    if (!project.assigned_port) {
      return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
    }

    const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
    return c.json({ status: 'exposed', project: project.name, publicUrl: url });
  });

  api.post('/projects/:id/unexpose', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    ctx.pipeline.closeTunnel(project.id);
    return c.json({ status: 'unexposed', project: project.name });
  });

  // --- GitHub Repos ---

  api.get('/repos', async (c) => {
    const config = loadConfig();
    const ghConfig = config.gitProviders.github;
    if (!ghConfig.token) {
      return c.json(
        { error: 'GITHUB_NOT_CONFIGURED', message: 'No GitHub token. Add one in setup.' },
        400,
      );
    }
    const provider = createGitProvider('github', ghConfig);
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const visibility = (c.req.query('visibility') ?? 'all') as 'all' | 'public' | 'private';
    const result = await provider.listRepos({ page, perPage: 30, visibility });
    return c.json({
      count: result.repos.length,
      hasMore: result.hasMore,
      repos: result.repos,
    });
  });

  api.get('/repos/search', async (c) => {
    const config = loadConfig();
    const ghConfig = config.gitProviders.github;
    if (!ghConfig.token) {
      return c.json(
        { error: 'GITHUB_NOT_CONFIGURED', message: 'No GitHub token. Add one in setup.' },
        400,
      );
    }
    const provider = createGitProvider('github', ghConfig);
    const query = c.req.query('q') ?? '';
    if (!query) {
      return c.json({ error: 'MISSING_FIELD', message: 'q (query) parameter is required' }, 400);
    }
    const result = await provider.searchRepos(query);
    return c.json({
      total: result.total,
      repos: result.repos,
    });
  });

  // --- System ---

  api.get('/system/stats', (c) => {
    const stats = getSystemStats();
    return c.json({
      summary: formatStatsSummary(stats),
      ...stats,
    });
  });

  api.get('/system/lan-ip', (c) => {
    const ip = getLanIp();
    const allIps = getAllIps();
    return c.json({ ip: ip ?? null, allIps });
  });

  // --- Server Status (v0.0.9) ---

  api.get('/server/status', async (c) => {
    try {
      // Get all containers
      const allContainers = await ctx.docker.listAllContainers();
      const managedContainers = allContainers.filter((c) => c.managedByOpenLander);
      const externalContainers = allContainers.filter((c) => !c.managedByOpenLander);

      // Get unique ports
      const portsSet = new Set<number>();
      for (const container of allContainers) {
        for (const port of container.ports) {
          if (port.PublicPort !== undefined) {
            portsSet.add(port.PublicPort);
          }
        }
      }

      // Detect reverse proxy
      const proxyDetection = await detectReverseProxy(ctx.docker);
      const proxyStatus = getProxyStatus(proxyDetection, 'managed');

      return c.json({
        containers: {
          total: allContainers.length,
          managed: managedContainers.length,
          external: externalContainers.length,
        },
        portsInUse: portsSet.size,
        proxy: {
          type: proxyDetection.type,
          status: proxyStatus,
          version: proxyDetection.version,
        },
        externalContainers: externalContainers.map((c) => ({
          name: c.name,
          image: c.image,
          ports: c.ports
            .filter((p): p is typeof p & { PublicPort: number } => p.PublicPort !== undefined)
            .map((p) => p.PublicPort),
        })),
      });
    } catch (err) {
      log.debug({ err }, 'Server status fetch failed');
      return c.json({
        containers: { total: 0, managed: 0, external: 0 },
        portsInUse: 0,
        proxy: { type: 'none', status: 'Unknown', version: undefined },
        externalContainers: [],
      });
    }
  });

  // --- Alerts ---

  api.get('/alerts', (c) => {
    const alerts = ctx.alertMonitor.getActiveAlerts();
    return c.json({ alerts });
  });

  api.post('/alerts/:id/dismiss', (c) => {
    const alertId = c.req.param('id');
    ctx.alertMonitor.dismissAlert(alertId);
    return c.json({ success: true });
  });

  return api;
}
