import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { resolveDeployableServiceForRoute } from './helpers/deployable-service-route-shared.js';
import {
  ENV_KEY_PATTERN,
  ENV_KEY_PATTERN_DESCRIPTION,
  parseEnvVariables,
  parseOptionalEnvScope,
} from './helpers/env-route-validation.js';
import { resolveRouteEnvironmentByKey } from './helpers/env-scope-route.js';

const SERVICE_ENV_WRITE_SCOPES = ['service', 'service_environment'] as const;

export function createServiceEnvRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:p/services/:s/env', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;
    const vars = await ctx.env.getAllForService(project.id, service.id);
    return c.json({ project: project.name, service: service.name, envVars: vars });
  });

  api.post('/projects/:p/services/:s/env', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const parsed = parseEnvVariables(body.variables);
    if (!parsed.ok) {
      return c.json({ error: parsed.error, message: parsed.message }, 400);
    }

    const parsedScope = parseOptionalEnvScope(body.scope, SERVICE_ENV_WRITE_SCOPES);
    if (!parsedScope.ok) {
      return c.json({ error: parsedScope.error, message: parsedScope.message }, 400);
    }

    const scope = parsedScope.scope ?? 'service';
    if (body.environment_key !== undefined && scope !== 'service_environment') {
      return c.json(
        {
          error: 'INVALID_FIELD',
          message: 'scope must be service_environment when environment_key is provided',
        },
        400,
      );
    }

    const environmentResolution =
      scope === 'service_environment'
        ? await resolveRouteEnvironmentByKey(ctx, project.id, body.environment_key)
        : undefined;
    if (environmentResolution && !environmentResolution.ok) {
      return c.json(
        { error: environmentResolution.error, message: environmentResolution.message },
        environmentResolution.status,
      );
    }

    const environmentId = environmentResolution?.environment.id;
    const changed =
      environmentId === undefined
        ? await ctx.env.setBulkForService(project.id, service.id, parsed.variables)
        : await ctx.env.setBulkForService(project.id, service.id, parsed.variables, environmentId);
    const keys = Object.keys(parsed.variables);
    if (changed) {
      await ctx.db.resolveAiOpsPendingInputsForServiceKeys(service.id, keys);
    }
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      service: service.name,
      ...(parsedScope.scope ? { scope } : {}),
      ...(environmentResolution ? { environment_key: environmentResolution.environmentKey } : {}),
      keys,
      needsRedeploy: changed && service.status === 'running',
    });
  });

  api.delete('/projects/:p/services/:s/env/:key', async (c) => {
    const resolved = await resolveDeployableServiceForRoute(c, ctx);
    if (resolved instanceof Response) return resolved;
    const { project, service } = resolved;
    const key = c.req.param('key');
    if (!ENV_KEY_PATTERN.test(key)) {
      return c.json(
        { error: 'INVALID_FIELD', message: `env key must match ${ENV_KEY_PATTERN_DESCRIPTION}` },
        400,
      );
    }
    const changed = await ctx.env.deleteForService(project.id, service.id, key);
    return c.json({
      status: changed ? 'deleted' : 'not_found',
      project: project.name,
      service: service.name,
      key,
      needsRedeploy: changed && service.status === 'running',
    });
  });

  return api;
}
