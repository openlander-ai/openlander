import { Hono } from 'hono';
import { streamSSE, stream } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { getSystemStats, formatStatsSummary } from '../../monitor/stats.js';
import { OpenLanderError, ProjectNotFoundError } from '../../errors.js';
import { createGitProvider } from '../../git-providers/index.js';
import { loadConfig } from '../../config/index.js';
import { eventBus, type EventType, type EventPayload } from '../../events/index.js';
import { SessionStore } from '../session.js';
import { createModuleLogger } from '../../lib/logger.js';

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
            ? (cpuDelta / systemDelta) * (stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1) * 100
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
        url: p.assigned_port ? `http://${p.name}.localhost` : null,
        publicUrl: p.public_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
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
      url: project.assigned_port ? `http://${project.name}.localhost` : null,
      envVars,
      recentDeploys: deployLogs,
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

    const result = await ctx.pipeline.redeploy(project.id);
    return c.json(result, result.success ? 200 : 500);
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
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        try {
          const container = ctx.docker.getClient().getContainer(project.container_id!);
          const logStream = await container.logs({
            follow: true,
            stdout: true,
            stderr: true,
            tail: 50,
          });

          logStream.on('data', (chunk: Buffer) => {
            const headerSize = 8;
            const streamType = chunk[0] === 1 ? 'stdout' : 'stderr';
            const line = chunk.slice(headerSize).toString('utf8').trim();

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
    const visibility = (c.req.query('visibility') as 'all' | 'public' | 'private') ?? 'all';
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

  // --- Chat ---

  api.post('/chat', async (c) => {
    if (!ctx.agent) {
      return c.json(
        {
          error: 'LLM_NOT_CONFIGURED',
          message: 'No LLM provider configured. Run `openlander onboard` first.',
        },
        400,
      );
    }

    const body = await c.req.json<{ message: string; session_id?: string }>();
    if (!body.message) {
      return c.json({ error: 'MISSING_FIELD', message: 'message is required' }, 400);
    }

    const sessionId = body.session_id ?? nanoid(12);
    const response = await ctx.agent.chat(body.message, sessionId);

    return c.json({
      sessionId,
      ...response,
    });
  });

  // --- Chat (SSE Streaming) ---

  api.post('/chat/stream', async (c) => {
    if (!ctx.agent) {
      return c.json(
        {
          error: 'LLM_NOT_CONFIGURED',
          message: 'No LLM provider configured. Run `openlander onboard` first.',
        },
        400,
      );
    }

    const body = await c.req.json<{ message: string; session_id?: string }>();
    if (!body.message) {
      return c.json({ error: 'MISSING_FIELD', message: 'message is required' }, 400);
    }

    const sessionId = body.session_id ?? nanoid(12);

    // Save user message before streaming
    sessionStore.addMessage(sessionId, 'user', body.message);

    return streamSSE(c, async (s) => {
      let eventId = 0;
      let assistantContent = '';

      await ctx.agent?.chatStream(
        body.message,
        async (event) => {
          await s.writeSSE({
            id: String(eventId++),
            event: event.type,
            data: JSON.stringify(event),
          });

          // Collect assistant content for saving
          if (event.type === 'message') {
            assistantContent += event.content;
          }
        },
        sessionId,
      );

      // Save assistant message after streaming completes
      if (assistantContent) {
        sessionStore.addMessage(sessionId, 'assistant', assistantContent);
      }
    });
  });

  return api;
}
