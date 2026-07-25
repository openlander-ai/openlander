import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import {
  EngagementMutationWebSessionRequiredError,
  EngagementValidationError,
} from '../../errors.js';

const engagementStatusSchema = z.enum(['active', 'on_hold', 'completed', 'archived']);
const editableEngagementStatusSchema = z.enum(['active', 'on_hold', 'completed']);

function requireWebSession(c: Context): void {
  if (c.get('authKind') !== 'session') {
    throw new EngagementMutationWebSessionRequiredError();
  }
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new EngagementValidationError('A valid JSON request body is required.');
  }
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new EngagementValidationError('Request body is invalid.', {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

export function createEngagementRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/engagements', async (c) => {
    const includeArchived = c.req.query('include_archived') === 'true';
    const statusValue = c.req.query('status');
    const status = statusValue ? engagementStatusSchema.safeParse(statusValue) : null;
    if (status && !status.success) {
      throw new EngagementValidationError('Invalid Engagement status filter.', {
        status: statusValue,
      });
    }
    const entries = await ctx.engagementService.list({
      includeArchived: includeArchived || status?.data === 'archived',
      ...(status?.success ? { status: status.data } : {}),
    });
    return c.json({ engagements: entries });
  });

  api.get('/engagements/unassigned-projects', async (c) => {
    return c.json({ projects: await ctx.engagementService.listUnassignedProjects() });
  });

  api.post('/engagements', async (c) => {
    requireWebSession(c);
    const body = parseBody(
      z
        .object({
          customer_name: z.string().trim().min(1).max(200),
          title: z.string().trim().min(1).max(200),
          summary: z.string().trim().max(4000).optional(),
          status: editableEngagementStatusSchema.optional(),
        })
        .strict(),
      await readJson(c),
    );
    const engagement = await ctx.engagementService.create({
      customerName: body.customer_name,
      title: body.title,
      summary: body.summary,
      status: body.status,
      actor: 'admin',
    });
    return c.json(engagement, 201);
  });

  api.get('/engagements/:engagementId', async (c) => {
    return c.json(await ctx.engagementService.get(c.req.param('engagementId')));
  });

  api.patch('/engagements/:engagementId', async (c) => {
    requireWebSession(c);
    const body = parseBody(
      z
        .object({
          customer_name: z.string().trim().min(1).max(200).optional(),
          title: z.string().trim().min(1).max(200).optional(),
          summary: z.string().trim().max(4000).optional(),
          status: editableEngagementStatusSchema.optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0, {
          message: 'At least one field is required.',
        }),
      await readJson(c),
    );
    return c.json(
      await ctx.engagementService.update(c.req.param('engagementId'), {
        customerName: body.customer_name,
        title: body.title,
        summary: body.summary,
        status: body.status,
        actor: 'admin',
      }),
    );
  });

  api.post('/engagements/:engagementId/archive', async (c) => {
    requireWebSession(c);
    return c.json(await ctx.engagementService.archive(c.req.param('engagementId'), 'admin'));
  });

  api.post('/engagements/:engagementId/unarchive', async (c) => {
    requireWebSession(c);
    return c.json(await ctx.engagementService.unarchive(c.req.param('engagementId'), 'admin'));
  });

  api.post('/engagements/:engagementId/projects', async (c) => {
    requireWebSession(c);
    const body = parseBody(
      z.object({ project_id: z.string().trim().min(1) }).strict(),
      await readJson(c),
    );
    return c.json(
      await ctx.engagementService.linkProject(
        c.req.param('engagementId'),
        body.project_id,
        'admin',
      ),
    );
  });

  api.delete('/engagements/:engagementId/projects/:projectId', async (c) => {
    requireWebSession(c);
    return c.json(
      await ctx.engagementService.unlinkProject(
        c.req.param('engagementId'),
        c.req.param('projectId'),
        'admin',
      ),
    );
  });

  api.get('/projects/:projectId/engagement', async (c) => {
    return c.json({
      engagement: await ctx.engagementService.getProjectReference(c.req.param('projectId')),
    });
  });

  return api;
}
