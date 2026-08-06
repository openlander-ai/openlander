import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import {
  disableDataSourceReadAccess,
  enableDataSourceReadAccess,
  listProjectDataSources,
} from '../../data-inspector/index.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import { assertDatabaseAccessAllowed } from '../../security/operation-permissions.js';

export function createDataAccessRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:id/data-sources', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const dataSources = await listProjectDataSources(ctx, project.id);
    return c.json({ project_id: project.id, data_sources: dataSources });
  });

  api.patch('/projects/:id/data-sources/:serviceId/access', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const serviceId = c.req.param('serviceId');
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const mode = body['mode'];
    if (mode !== 'read' && mode !== 'disabled') {
      return c.json(
        {
          error: 'INVALID_MODE',
          code: 'INVALID_MODE',
          message: 'mode must be "read" or "disabled".',
        },
        400,
      );
    }

    if (mode === 'read') {
      await assertDatabaseAccessAllowed(ctx.db, {
        projectId: project.id,
        serviceId,
      });
    }

    const result =
      mode === 'read'
        ? await enableDataSourceReadAccess(ctx, project.id, serviceId)
        : await disableDataSourceReadAccess(ctx, project.id, serviceId);

    if ('error' in result) {
      return c.json(result, result.error === 'DATA_SOURCE_NOT_FOUND' ? 404 : 400);
    }
    return c.json({ project_id: project.id, data_source: result });
  });

  return api;
}
