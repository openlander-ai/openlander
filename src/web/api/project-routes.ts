import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { rm } from 'node:fs/promises';

import type { AppContext } from '../../app.js';
import { ProjectNotFoundError, TunnelStartError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getPostmortemInstance } from '../../monitor/postmortem.js';
import { encrypt } from '../../env/crypto.js';
import { getProjectUrl } from '../../pipeline/traefik.js';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import { generateEnvExample } from '../../pipeline/env-inject.js';
import type { EnvironmentRow, EnvironmentType } from '../../db/index.js';

const log = createModuleLogger('api');

const DEFAULT_ENVIRONMENT_BRANCHES: Record<EnvironmentType, string> = {
  production: 'main',
  staging: 'develop',
  development: 'dev',
};

function isEnvironmentType(value: unknown): value is EnvironmentType {
  return value === 'production' || value === 'staging' || value === 'development';
}

function mapEnvironment(environment: EnvironmentRow) {
  return {
    ...environment,
    created_at: normalizeTimestamp(environment.created_at),
    updated_at: normalizeTimestamp(environment.updated_at),
  };
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const sqliteLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalizedInput = sqliteLike.test(trimmed) ? trimmed.replace(' ', 'T') + 'Z' : trimmed;
  const parsed = new Date(normalizedInput);

  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString();
}

function extractFailureSummary(buildLog: string | null): string | null {
  if (!buildLog) return null;

  const lines = buildLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = lines.find((line) => /error|failed|exception/i.test(line));
  return errorLine ?? lines.at(-1) ?? null;
}

export function createProjectRoutes(ctx: AppContext): Hono {
  const api = new Hono();

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
      projects: projects.map((p) => {
        const environments = ctx.db.getEnvironmentsByProject(p.id);
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          visibility: p.visibility,
          repoUrl: p.repo_url,
          branch: p.branch,
          port: p.assigned_port,
          url: p.assigned_port ? getProjectUrl(p.name) : null,
          publicUrl: p.public_url,
          createdAt: normalizeTimestamp(p.created_at),
          updatedAt: normalizeTimestamp(p.updated_at),
          parentProjectId: p.parent_project_id,
          isCompose: ctx.db.isParentProject(p.id),
          serviceCount: ctx.db.getChildProjects(p.id).length,
          environments: environments.map(mapEnvironment),
        };
      }),
    });
  });

  api.get('/projects/:id', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const envVars = ctx.env.getAllMasked(project.id);
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const deployLogs = ctx.db.getDeployLogs(project.id, 5);

    return c.json({
      ...project,
      port: project.assigned_port ?? null,
      url: project.assigned_port ? getProjectUrl(project.name) : null,
      created_at: normalizeTimestamp(project.created_at),
      updated_at: normalizeTimestamp(project.updated_at),
      environments: environments.map(mapEnvironment),
      envVars,
      recentDeploys: deployLogs,
    });
  });

  api.post('/projects/:id/environments', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req
      .json<{ type?: unknown; branch?: unknown }>()
      .catch(() => ({ type: undefined, branch: undefined }));

    if (!isEnvironmentType(body.type)) {
      return c.json(
        {
          error: 'INVALID_ENVIRONMENT_TYPE',
          message: 'type must be one of: production, staging, development',
        },
        400,
      );
    }

    const existing = ctx.db
      .getEnvironmentsByProject(project.id)
      .find((environment) => environment.type === body.type);
    if (existing) {
      return c.json(
        {
          error: 'ENVIRONMENT_ALREADY_EXISTS',
          message: `${body.type} environment already exists for project`,
        },
        409,
      );
    }

    const branch =
      typeof body.branch === 'string' && body.branch.trim().length > 0
        ? body.branch.trim()
        : DEFAULT_ENVIRONMENT_BRANCHES[body.type];

    const created = ctx.db.createEnvironment({
      id: crypto.randomUUID(),
      projectId: project.id,
      type: body.type,
      branch,
    });

    return c.json({ environment: mapEnvironment(created) });
  });

  api.get('/projects/:id/environments', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const environments = ctx.db.getEnvironmentsByProject(project.id);
    return c.json({ environments: environments.map(mapEnvironment) });
  });

  api.get('/projects/:id/environments/:envId', (c) => {
    const id = c.req.param('id');
    const envId = c.req.param('envId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const environment = ctx.db.getEnvironment(envId);
    if (!environment || environment.project_id !== project.id) {
      return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message: 'Environment not found' }, 404);
    }

    return c.json({ environment: mapEnvironment(environment) });
  });

  api.delete('/projects/:id/environments/:envId', (c) => {
    const id = c.req.param('id');
    const envId = c.req.param('envId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const environment = ctx.db.getEnvironment(envId);
    if (!environment || environment.project_id !== project.id) {
      return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message: 'Environment not found' }, 404);
    }

    if (environment.type === 'production') {
      return c.json(
        {
          error: 'PRODUCTION_ENVIRONMENT_PROTECTED',
          message: 'Production environment cannot be deleted',
        },
        400,
      );
    }

    ctx.db.deleteEnvironment(environment.id);
    return c.json({ status: 'deleted', environmentId: environment.id });
  });

  api.get('/projects/:id/environments/:envId/env', (c) => {
    const id = c.req.param('id');
    const envId = c.req.param('envId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const environment = ctx.db.getEnvironment(envId);
    if (!environment || environment.project_id !== project.id) {
      return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message: 'Environment not found' }, 404);
    }

    const envVars = ctx.env.getAllWithInheritance(project.id, environment.id);
    const inheritance = ctx.env.getInheritanceInfo(project.id, environment.id);

    return c.json({
      environment: mapEnvironment(environment),
      envVars,
      inheritance,
    });
  });

  api.post('/projects/:id/environments/:envId/env', async (c) => {
    const id = c.req.param('id');
    const envId = c.req.param('envId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const environment = ctx.db.getEnvironment(envId);
    if (!environment || environment.project_id !== project.id) {
      return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message: 'Environment not found' }, 404);
    }

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = ctx.env.setBulk(project.id, body.variables, environment.id);
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      environment: environment.type,
      keys: Object.keys(body.variables),
      needsRedeploy: changed && environment.status === 'running',
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
        createdAt: normalizeTimestamp(log.created_at),
        failureSummary: log.status === 'failed' ? extractFailureSummary(log.build_log) : null,
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
      createdAt: normalizeTimestamp(log.created_at),
    });
  });

  // v0.2.3: Start a stopped project
  api.post('/projects/:id/start', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const environmentRow = environments.find(
      (environment) => environment.type === requestedEnvironment,
    );

    if (requestedEnvironment !== 'production' && !environmentRow) {
      return c.json(
        {
          error: 'ENVIRONMENT_NOT_FOUND',
          message: `${requestedEnvironment} environment not found for project`,
        },
        404,
      );
    }

    if (requestedEnvironment === 'production') {
      if (!project.container_id) {
        return c.json({ error: 'No container to start. Redeploy instead.' }, 400);
      }
      await ctx.pipeline.start(project.id);
    } else if (environmentRow) {
      if (!environmentRow.container_id) {
        return c.json({ error: 'No container to start. Redeploy instead.' }, 400);
      }
      await ctx.pipeline.start(project.id, environmentRow.id);
    }
    return c.json({ status: 'started', project: project.name });
  });

  api.post('/projects/:id/stop', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const environmentRow = environments.find(
      (environment) => environment.type === requestedEnvironment,
    );

    if (requestedEnvironment !== 'production' && !environmentRow) {
      return c.json(
        {
          error: 'ENVIRONMENT_NOT_FOUND',
          message: `${requestedEnvironment} environment not found for project`,
        },
        404,
      );
    }

    if (requestedEnvironment === 'production') {
      await ctx.pipeline.stop(project.id);
    } else if (environmentRow) {
      await ctx.pipeline.stop(project.id, environmentRow.id);
    }
    return c.json({ status: 'stopped', project: project.name });
  });

  api.post('/projects/:id/redeploy', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const environmentRow = environments.find(
      (environment) => environment.type === requestedEnvironment,
    );

    if (requestedEnvironment !== 'production' && !environmentRow) {
      return c.json(
        {
          error: 'ENVIRONMENT_NOT_FOUND',
          message: `${requestedEnvironment} environment not found for project`,
        },
        404,
      );
    }

    // If caller provides env_vars, persist them before redeploying
    const body = await c.req
      .json<{ env_vars?: Record<string, string> }>()
      .catch(() => ({ env_vars: undefined }));
    if (body.env_vars && typeof body.env_vars === 'object') {
      if (requestedEnvironment === 'production') {
        ctx.env.setBulk(project.id, body.env_vars);
      } else if (environmentRow) {
        ctx.env.setBulk(project.id, body.env_vars, environmentRow.id);
      }
    }

    try {
      if (requestedEnvironment === 'production') {
        ctx.db.updateProject(project.id, { status: 'building' });
        const result = await ctx.pipeline.redeploy(project.id);
        return c.json(result, result.success ? 200 : 500);
      } else if (environmentRow) {
        ctx.db.updateEnvironment(environmentRow.id, { status: 'building' });
        const result = await ctx.pipeline.deployEnvironment(project.id, environmentRow.id, {
          trigger: 'api',
        });
        return c.json(result, result.success ? 200 : 500);
      }
      return c.json({ success: false, error: 'Unknown environment' }, 500);
    } catch (err) {
      if (requestedEnvironment === 'production') {
        ctx.db.updateProject(project.id, { status: 'error' });
      } else if (environmentRow) {
        ctx.db.updateEnvironment(environmentRow.id, { status: 'error' });
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    }
  });

  // v0.3: Rollback
  api.post('/projects/:id/rollback', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const environmentRow = environments.find(
      (environment) => environment.type === requestedEnvironment,
    );

    if (requestedEnvironment !== 'production' && !environmentRow) {
      return c.json(
        {
          error: 'ENVIRONMENT_NOT_FOUND',
          message: `${requestedEnvironment} environment not found for project`,
        },
        404,
      );
    }

    let result;
    if (requestedEnvironment === 'production') {
      result = await ctx.pipeline.rollback(project.id);
    } else if (environmentRow) {
      result = await ctx.pipeline.rollback(project.id, environmentRow.id);
    } else {
      return c.json({ success: false, error: 'Unknown environment' }, 500);
    }
    return c.json(result, result.success ? 200 : 500);
  });

  // v0.3: Blue-green deployment
  api.post('/projects/:id/blue-green', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    if (requestedEnvironment !== 'production') {
      return c.json(
        {
          success: false,
          error:
            'Blue-green deployment is currently only supported for the production environment.',
        },
        400,
      );
    }

    const body = await c.req
      .json<{ health_check_path?: string }>()
      .catch((): { health_check_path?: string } => ({}));
    const result = await ctx.blueGreen.deploy(project.id, {
      healthCheckPath: body.health_check_path,
    });
    return c.json(result, result.success ? 200 : 500);
  });

  // v0.2.3: Webhook settings API
  api.get('/projects/:id/webhooks', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);
    const configs = ctx.db.getWebhookConfigs(project.id);
    return c.json({
      webhooks: configs.map((cfg) => ({
        id: cfg.id,
        source: cfg.source,
        secret: cfg.secret,
        branchFilter: cfg.branch_filter,
        enabled: cfg.enabled === 1,
        webhookUrl: `/api/webhooks/${project.id}/${cfg.source}`,
        createdAt: normalizeTimestamp(cfg.created_at),
      })),
    });
  });

  api.post('/projects/:id/webhooks', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);
    const body = await c.req.json<{ source: string; branch_filter?: string; enabled?: boolean }>();
    if (!body.source || !['github', 'gitlab', 'bitbucket'].includes(body.source)) {
      return c.json({ error: 'Invalid source. Must be github, gitlab, or bitbucket.' }, 400);
    }
    const source = body.source as 'github' | 'gitlab' | 'bitbucket';
    const existing = ctx.db.getWebhookConfig(project.id, source);
    const secret = existing?.secret ?? `${project.id}.${crypto.randomUUID().replace(/-/g, '')}`;
    const configId = existing?.id ?? crypto.randomUUID();
    ctx.db.setWebhookConfig({
      id: configId,
      projectId: project.id,
      source,
      secret,
      branchFilter: body.branch_filter ?? 'main',
      enabled: body.enabled !== false,
    });
    const config = ctx.db.getWebhookConfig(project.id, source);
    if (!config) {
      return c.json({ error: 'Failed to configure webhook' }, 500);
    }
    return c.json({
      id: config.id,
      source: config.source,
      secret: config.secret,
      branchFilter: config.branch_filter,
      enabled: config.enabled === 1,
      webhookUrl: `/api/webhooks/${project.id}/${config.source}`,
    });
  });

  api.delete('/projects/:id/webhooks/:source', (c) => {
    const id = c.req.param('id');
    const source = c.req.param('source');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);
    if (!['github', 'gitlab', 'bitbucket'].includes(source)) {
      return c.json({ error: 'Invalid source' }, 400);
    }
    ctx.db.deleteWebhookConfig(project.id, source as 'github' | 'gitlab' | 'bitbucket');
    return c.json({ status: 'deleted' });
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

    const body = await c.req.json<{ action: string }>().catch(() => ({ action: '' }));
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

    await ctx.pipeline.remove(project.id, ctx.cloudflare);
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

  api.get('/projects/:id/env-example', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);
    if (!project.repo_url) {
      return c.json({ error: 'MISSING_REPO_URL', message: 'Project has no repository URL' }, 400);
    }

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const allowedEnvironments = new Set(['production', 'staging', 'development']);
    if (!allowedEnvironments.has(requestedEnvironment)) {
      return c.json(
        {
          error: 'INVALID_ENVIRONMENT',
          message: 'environment must be one of: production, staging, development',
        },
        400,
      );
    }

    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const environmentRow = environments.find(
      (environment) => environment.type === requestedEnvironment,
    );
    if (environments.length > 0 && !environmentRow) {
      return c.json(
        {
          error: 'ENVIRONMENT_NOT_FOUND',
          message: `${requestedEnvironment} environment not found for project`,
        },
        404,
      );
    }

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({
        repoUrl: project.repo_url,
        branch: environmentRow?.branch ?? project.branch,
      });
      clonePath = cloneResult.path;
      const scanResult = scanForEnvUsage(clonePath);
      const existingVars = environmentRow
        ? ctx.env.getAllWithInheritance(project.id, environmentRow.id)
        : ctx.env.getAll(project.id);
      const envExample = generateEnvExample(scanResult, existingVars);
      return c.text(envExample);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'ENV_EXAMPLE_GENERATION_FAILED', message }, 500);
    } finally {
      if (clonePath) {
        await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
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

    try {
      const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
      return c.json({ status: 'exposed', project: project.name, publicUrl: url });
    } catch (error) {
      if (error instanceof TunnelStartError) {
        return c.json(
          {
            error: 'TUNNEL_START_FAILED',
            message: 'Cloudflare service is temporarily unavailable. Please try again.',
          },
          503,
        );
      }
      throw error;
    }
  });

  api.post('/projects/:id/unexpose', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    ctx.pipeline.closeTunnel(project.id);
    return c.json({ status: 'unexposed', project: project.name });
  });

  api.post('/projects/:id/share', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const body = await c.req.json<{ accessCode: string }>();
    if (!body.accessCode || body.accessCode.length < 4) {
      return c.json(
        {
          error: 'INVALID_ACCESS_CODE',
          message: 'Access code must be at least 4 characters',
        },
        400,
      );
    }

    const { encrypted, iv } = encrypt(body.accessCode);

    if (project.visibility !== 'quick-share' && project.visibility !== 'shared') {
      if (!project.assigned_port) {
        return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
      } catch (error) {
        if (error instanceof TunnelStartError) {
          return c.json(
            {
              error: 'TUNNEL_START_FAILED',
              message: 'Cloudflare service is temporarily unavailable. Please try again.',
            },
            503,
          );
        }
        throw error;
      }
    }

    let tunnel = ctx.pipeline.getTunnel(project.id);
    if (!tunnel) {
      const assignedPort = project.assigned_port;
      if (assignedPort === null) {
        return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        await ctx.pipeline.exposeTunnel(project.id, assignedPort);
      } catch (error) {
        if (error instanceof TunnelStartError) {
          return c.json(
            {
              error: 'TUNNEL_START_FAILED',
              message: 'Cloudflare service is temporarily unavailable. Please try again.',
            },
            503,
          );
        }
        throw error;
      }
      tunnel = ctx.pipeline.getTunnel(project.id);
    }

    if (!tunnel) {
      return c.json(
        {
          error: 'TUNNEL_UNAVAILABLE',
          message: 'Failed to initialize quick-share tunnel',
        },
        500,
      );
    }

    tunnel.enableSharedMode(project.name, body.accessCode);

    ctx.db.updateProject(project.id, {
      visibility: 'shared',
      accessCode: encrypted,
      accessCodeIv: iv,
    });

    const updatedProject = ctx.db.getProject(project.id);
    return c.json({
      status: 'shared',
      project: project.name,
      publicUrl: updatedProject?.public_url,
    });
  });

  api.delete('/projects/:id/share', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const tunnel = ctx.pipeline.getTunnel(project.id);
    if (tunnel) {
      tunnel.disableSharedMode(project.name);
    }

    ctx.db.updateProject(project.id, {
      visibility: 'quick-share',
      accessCode: null,
      accessCodeIv: null,
    });

    return c.json({ status: 'unshared', project: project.name });
  });

  api.get('/projects/:id/previews', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const previews = ctx.db.getPreviewProjects(project.id);
    return c.json({
      previews: previews.map((preview) => ({
        id: preview.id,
        name: preview.name,
        status: preview.status,
        prNumber: preview.pr_number,
        url: getProjectUrl(preview.name),
        publicUrl: preview.public_url,
        createdAt: normalizeTimestamp(preview.created_at),
        updatedAt: normalizeTimestamp(preview.updated_at),
      })),
    });
  });

  api.delete('/projects/:id/previews/:previewId', async (c) => {
    const id = c.req.param('id');
    const previewId = c.req.param('previewId');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) throw new ProjectNotFoundError(id);

    const preview = ctx.db.getProject(previewId);
    if (!preview || preview.parent_project_id !== project.id) {
      return c.json({ error: 'PREVIEW_NOT_FOUND', message: 'Preview not found' }, 404);
    }

    await ctx.pipeline.remove(previewId, ctx.cloudflare);
    return c.json({ status: 'removed', preview: preview.name });
  });

  api.get('/projects/:id/postmortem/latest', (c) => {
    const id = c.req.param('id');
    const postmortem = getPostmortemInstance();
    const entry = postmortem?.getLatest(id);
    if (!entry) {
      return c.body(null, 204);
    }
    return c.json({
      projectId: entry.projectId,
      projectName: entry.projectName,
      markdown: entry.markdown,
      generatedAt: entry.generatedAt.toISOString(),
    });
  });

  return api;
}
