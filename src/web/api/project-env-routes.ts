import { Hono } from 'hono';
import { rm } from 'node:fs/promises';

import type { AppContext } from '../../app.js';
import type { ProjectRow, ServiceRow } from '../../db/index.js';
import { ServiceSelectionRequiredError } from '../../errors.js';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import { generateEnvExample } from '../../pipeline/env-inject.js';
import {
  getEnvironmentByIdOrThrow,
  getProjectOrThrow,
  resolveEnvironmentByType,
} from './helpers/project-helpers.js';
import { mapEnvironment } from './helpers/project-route-shared.js';
import { parseEnvVariables } from './helpers/env-route-validation.js';

async function resolveProjectEnvCompatService(
  ctx: AppContext,
  project: ProjectRow,
): Promise<ServiceRow | undefined> {
  const deployables = await ctx.db.getDeployablesByGroup(project.id);
  if (deployables.length === 0) return undefined;
  if (deployables.length === 1) return deployables[0];
  throw new ServiceSelectionRequiredError(
    project.id,
    project.name,
    deployables.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      kind: service.kind,
      source: service.source,
    })),
  );
}

export function createProjectEnvRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/projects/:id/environments', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment creation is disabled' }, 410);
  });

  api.get('/projects/:id/environments', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    return c.json({ environments: environments.map((env) => mapEnvironment(project.name, env)) });
  });

  api.get('/projects/:id/environments/:envId', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    return c.json({ environment: mapEnvironment(project.name, environment) });
  });

  api.delete('/projects/:id/environments/:envId', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment deletion is disabled' }, 410);
  });

  api.get('/projects/:id/environments/:envId/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const envVars = await ctx.env.getAllWithInheritance(project.id, environment.id);
    const inheritance = ctx.env.getInheritanceInfo(project.id, environment.id);

    return c.json({
      environment: mapEnvironment(project.name, environment),
      envVars,
      inheritance,
    });
  });

  api.post('/projects/:id/environments/:envId/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const parsed = parseEnvVariables(body.variables);
    if (!parsed.ok) {
      return c.json({ error: parsed.error, message: parsed.message }, 400);
    }

    const changed = await ctx.env.setBulk(project.id, parsed.variables, environment.id);
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      environment: environment.type,
      keys: Object.keys(parsed.variables),
      needsRedeploy: changed && environment.status === 'running',
    });
  });

  api.get('/projects/:id/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const service = await resolveProjectEnvCompatService(ctx, project);
    const vars = service
      ? await ctx.env.getAllForService(project.id, service.id)
      : await ctx.env.getAll(project.id);
    return c.json({
      project: project.name,
      ...(service ? { service: service.name } : {}),
      envVars: vars,
    });
  });

  api.get('/projects/:id/env-example', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const deployable = await ctx.db.getDeployableForProject(project.id);
    if (!deployable?.repo_url) {
      return c.json(
        {
          error: 'SERVICE_SOURCE_MISSING',
          code: 'SERVICE_SOURCE_MISSING',
          message: 'Service has no repository URL',
        },
        400,
      );
    }

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const allowedEnvironments = new Set(['production', 'development']);
    if (!allowedEnvironments.has(requestedEnvironment)) {
      return c.json(
        {
          error: 'INVALID_ENVIRONMENT',
          message: 'environment must be one of: production, development',
        },
        400,
      );
    }

    const environmentResolution = await resolveEnvironmentByType(c, ctx, project, {
      requireExistingEnvironmentWhenAnyExists: true,
    });
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({
        repoUrl: deployable.repo_url,
        branch: environmentRow?.branch ?? deployable.branch ?? undefined,
      });
      clonePath = cloneResult.path;
      const scanResult = scanForEnvUsage(clonePath);
      const existingVars = await ctx.env.getAllForService(project.id, deployable.id);
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
    const project = await getProjectOrThrow(c, ctx);

    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const parsed = parseEnvVariables(body.variables);
    if (!parsed.ok) {
      return c.json({ error: parsed.error, message: parsed.message }, 400);
    }

    const service = await resolveProjectEnvCompatService(ctx, project);
    const changed = service
      ? await ctx.env.setBulkForService(project.id, service.id, parsed.variables)
      : await ctx.env.setBulk(project.id, parsed.variables);
    const status = service?.status ?? project.status;
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      ...(service ? { service: service.name } : {}),
      keys: Object.keys(parsed.variables),
      needsRedeploy: changed && status === 'running',
    });
  });

  return api;
}
