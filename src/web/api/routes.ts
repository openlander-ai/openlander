import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';

import type { AppContext } from '../../app.js';
import { getSystemStats, formatStatsSummary } from '../../monitor/stats.js';
import { OpenLanderError, ProjectNotFoundError } from '../../errors.js';

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
    console.error('[API Error]', err);
    return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
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
        { error: 'LLM_NOT_CONFIGURED', message: 'No LLM provider configured. Run `openlander onboard` first.' },
        400,
      );
    }

    const body = await c.req.json<{ message: string; session_id?: string }>();
    if (!body.message) {
      return c.json({ error: 'MISSING_FIELD', message: 'message is required' }, 400);
    }

    return streamSSE(c, async (stream) => {
      let eventId = 0;

      await ctx.agent?.chatStream(
        body.message,
        async (event) => {
          await stream.writeSSE({
            id: String(eventId++),
            event: event.type,
            data: JSON.stringify(event),
          });
        },
        body.session_id,
      );
    });
  });

  return api;
}
