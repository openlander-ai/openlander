import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import { createModuleLogger } from '../../lib/logger.js';
import { parseDockerLogChunk } from './helpers/docker-log-timestamps.js';

const log = createModuleLogger('api:service-logs');

export function createServiceLogRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:p/services/:s/logs', async (c) => {
    // Keep the legacy log-route contract intact: this route has three distinct
    // 404 codes and intentionally does not use the generic deployable resolver.
    const projectParam = c.req.param('p');
    const serviceId = c.req.param('s');
    const project =
      (await ctx.db.getProject(projectParam)) ?? (await ctx.db.getProjectByName(projectParam));
    if (!project) {
      return c.json(
        { error: 'PROJECT_NOT_FOUND', message: `Project ${projectParam} not found` },
        404,
      );
    }
    const service = await ctx.db.getService(serviceId);
    if (!service) {
      return c.json({ error: 'SERVICE_NOT_FOUND', message: `Service ${serviceId} not found` }, 404);
    }
    if (service.project_id !== project.id) {
      return c.json(
        {
          error: 'SERVICE_NOT_IN_PROJECT',
          message: `Service ${serviceId} does not belong to project ${project.id}`,
        },
        404,
      );
    }

    const containerId = service.container_id ?? service.container_name ?? '';
    const follow = c.req.query('follow');

    if (follow && containerId) {
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');
        try {
          const logStream = await ctx.docker.getLogStream(containerId, {
            tail: 50,
            timestamps: true,
          });

          logStream.on('data', (chunk: Buffer) => {
            for (const logEntry of parseDockerLogChunk(chunk)) {
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
            // Stream cleans up automatically on abort.
          });
        } catch (err) {
          log.debug({ err, serviceId }, 'Per-service log streaming failed');
          void s.write(JSON.stringify({ error: 'Failed to stream logs' }) + '\n');
          void s.close();
        }
      });
    }

    const lines = parseInt(c.req.query('lines') ?? '50', 10);
    const tail = Number.isInteger(lines) && lines > 0 ? lines : 50;
    const logs = containerId
      ? await ctx.docker.getLogs(containerId, tail, { timestamps: true })
      : '';
    return c.json({ project: project.name, service: service.name, logs });
  });

  return api;
}
