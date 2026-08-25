import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import {
  PostgresMigrationRehearsalInputError,
  PostgresMigrationTargetInvalidError,
} from '../../errors.js';
import {
  POSTGRES_MIGRATION_TARGETS,
  type PostgresMigrationTarget,
} from '../../migration/postgres-runbook-types.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const postgresPreflightBodySchema = z
  .object({ service_id: z.string().trim().min(1).optional() })
  .strict();

const postgresRehearsalBodySchema = z
  .object({
    service_id: z.string().trim().min(1).optional(),
    target: z
      .object({
        provider: z.enum(POSTGRES_MIGRATION_TARGETS),
        host: z.string(),
        port: z.number(),
        database: z.string(),
        user: z.string(),
        password: z.string(),
        ssl_mode: z.literal('require'),
        confirm_empty_target: z.literal(true),
      })
      .strict(),
  })
  .strict();

function requireWebSession(c: Context): Response | null {
  if (c.get('authKind') === 'session') return null;
  return c.json(
    {
      error: 'WEB_SESSION_REQUIRED',
      code: 'WEB_SESSION_REQUIRED',
      message: 'PostgreSQL migration rehearsal requires an authenticated web session.',
    },
    403,
  );
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new PostgresMigrationRehearsalInputError('body', 'invalid_json');
  }
}

export function createMigrationRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/migration/runbook', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const rawTarget = c.req.query('target')?.trim() ?? '';
    if (!(POSTGRES_MIGRATION_TARGETS as readonly string[]).includes(rawTarget)) {
      throw new PostgresMigrationTargetInvalidError(rawTarget || null);
    }
    const serviceId = c.req.query('service_id')?.trim() || undefined;
    return c.json(
      await ctx.projectMigrationService.createPostgresMigrationRunbookBundle(
        project.id,
        rawTarget as PostgresMigrationTarget,
        serviceId,
      ),
    );
  });

  api.post('/projects/:id/migration/preflight', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const parsed = postgresPreflightBodySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new PostgresMigrationRehearsalInputError('body', 'invalid_preflight_request');
    }
    return c.json({
      preflight: await ctx.projectMigrationService.createPostgresMigrationPreflight(
        project.id,
        parsed.data.service_id,
      ),
    });
  });

  api.post('/projects/:id/migration/rehearsals', async (c) => {
    const sessionError = requireWebSession(c);
    if (sessionError) return sessionError;
    const project = await getProjectOrThrow(c, ctx);
    const parsed = postgresRehearsalBodySchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw new PostgresMigrationRehearsalInputError('body', 'invalid_rehearsal_request');
    }
    const rehearsal = await ctx.projectMigrationService.startPostgresMigrationRehearsal(
      project.id,
      parsed.data.service_id,
      parsed.data.target,
    );
    return c.json({ rehearsal }, 202);
  });

  api.get('/projects/:id/migration/rehearsals/:runId', async (c) => {
    const sessionError = requireWebSession(c);
    if (sessionError) return sessionError;
    const project = await getProjectOrThrow(c, ctx);
    return c.json({
      rehearsal: ctx.projectMigrationService.getPostgresMigrationRehearsal(
        project.id,
        c.req.param('runId'),
      ),
    });
  });

  api.get('/projects/:id/migration', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    return c.json(await ctx.projectMigrationService.createBundle(project.id));
  });

  return api;
}
