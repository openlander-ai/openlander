import { Hono, type Context } from 'hono';

import type { AppContext } from '../../app.js';
import { ApplicationOperationValidationError, AuthenticationError } from '../../errors.js';
import { applicationOperationActorForRest } from '../../operations/index.js';

function requireRestActor(ctx: AppContext, authKind: unknown) {
  if (authKind !== 'session' && authKind !== 'api_token') {
    throw new AuthenticationError('A web session or API token is required for operations.');
  }
  return applicationOperationActorForRest({
    instanceId: ctx.config.mcp.instanceId?.trim() || 'unconfigured-instance',
    authKind,
  });
}

function requestAuthKind(c: Context): unknown {
  return c.get('authKind');
}

function readVersion(value: string | undefined, operationName: string): number | undefined {
  if (value === undefined) return undefined;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApplicationOperationValidationError(operationName, [
      { path: ['version'], message: 'x-openlander-operation-version must be a positive integer' },
    ]);
  }
  return version;
}

export function createOperationRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/v1/operations', (c) => {
    requireRestActor(ctx, requestAuthKind(c));
    return c.json({ operations: ctx.operations.list() });
  });

  api.get('/v1/operations/status/:id', async (c) => {
    const actor = requireRestActor(ctx, requestAuthKind(c));
    return c.json(await ctx.operations.status(ctx, c.req.param('id'), actor));
  });

  api.post('/v1/operations/:name', async (c) => {
    const operationName = c.req.param('name');
    const actor = requireRestActor(ctx, requestAuthKind(c));
    let input: unknown;
    try {
      input = await c.req.json<unknown>();
    } catch {
      throw new ApplicationOperationValidationError(operationName, [
        { path: [], message: 'Request body must be valid JSON.' },
      ]);
    }
    const result = await ctx.operations.execute(ctx, operationName, input, {
      actor,
      idempotencyKey: c.req.header('idempotency-key'),
      version: readVersion(c.req.header('x-openlander-operation-version'), operationName),
    });
    return c.json(result);
  });

  return api;
}
