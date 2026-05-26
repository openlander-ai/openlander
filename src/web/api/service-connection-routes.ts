import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { autoInjectServiceEnv, cleanupAutoInjectedEnv } from '../../pipeline/env-inject.js';
import { kindToLegacyType } from '../../db/repos/service.repo.js';
import { projectIdToDeployableServiceId } from '../../db/service-ids.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const log = createModuleLogger('api:service-connection');

function parseServiceCredentials(credentials: string | null): Record<string, string> | undefined {
  if (!credentials) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(credentials);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const entries = Object.entries(parsed);
    const normalized: Record<string, string> = {};
    for (const [key, value] of entries) {
      if (typeof value === 'string') {
        normalized[key] = value;
        continue;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        normalized[key] = String(value);
      }
    }
    return normalized;
  } catch {
    return undefined;
  }
}

export function createServiceConnectionRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/projects/:id/services/:serviceId', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const serviceId = c.req.param('serviceId');

    const service = await ctx.db.getService(serviceId);
    if (!service) {
      return c.json({ error: 'SERVICE_NOT_FOUND', message: 'Service not found' }, 404);
    }

    const existing = await ctx.db.getServiceConnectionByProjectAndService(project.id, serviceId);
    if (existing) {
      return c.json({ error: 'ALREADY_CONNECTED', message: 'Service already connected' }, 409);
    }

    const connection = await ctx.db.createServiceConnection({
      projectId: project.id,
      serviceId,
    });

    const credentials = parseServiceCredentials(service.credentials);
    // Wire contract: emit legacy vocabulary (postgresql/mongodb) for back-compat.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const serviceKind = service.type ?? kindToLegacyType(service.kind);
    const injectedKeys = await autoInjectServiceEnv({
      db: ctx.db,
      env: ctx.env,
      projectId: project.id,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: serviceKind,
      containerName: service.container_name ?? '',
      credentials,
    });
    await ctx.db.updateServiceConnection(connection.id, {
      autoInjectedEnvKeys: JSON.stringify(injectedKeys),
    });

    try {
      await ctx.db.createProjectDependency({
        source_service_id: projectIdToDeployableServiceId(project.id),
        target_service_id: serviceId,
        dependency_type:
          serviceKind === 'postgres' || serviceKind === 'postgresql' || serviceKind === 'mysql'
            ? 'database'
            : serviceKind === 'redis'
              ? 'cache'
              : 'custom',
        source: 'auto',
      });
    } catch (err) {
      log.debug({ err, projectId: project.id, serviceId }, 'Auto dependency sync failed');
    }

    return c.json(
      {
        id: connection.id,
        service: {
          id: service.id,
          name: service.name,
          // Wire key preserved; canonical source: kind
          type: serviceKind,
          status: service.status,
          // Wire key preserved; canonical source: assigned_port
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          port: service.assigned_port ?? service.port,
          containerName: service.container_name,
        },
        createdAt: connection.created_at,
        autoInjectedEnvKeys: injectedKeys,
      },
      201,
    );
  });

  api.delete('/projects/:id/services/:serviceId', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const serviceId = c.req.param('serviceId');

    const existing = await ctx.db.getServiceConnectionByProjectAndService(project.id, serviceId);
    if (!existing) {
      return c.json(
        { error: 'NOT_CONNECTED', message: 'Service not connected to this project' },
        404,
      );
    }

    const parsedAutoInjected = JSON.parse(existing.auto_injected_env_keys ?? '[]') as unknown;
    const autoInjectedEnvKeys = Array.isArray(parsedAutoInjected)
      ? parsedAutoInjected.filter((key): key is string => typeof key === 'string')
      : [];
    await cleanupAutoInjectedEnv({
      db: ctx.db,
      env: ctx.env,
      projectId: project.id,
      autoInjectedEnvKeys,
    });

    await ctx.db.deleteServiceConnectionByProjectAndService(project.id, serviceId);

    try {
      const deps = await ctx.db.findDependenciesByProject(project.id);
      const matchingDep = deps.find(
        (d) => d.target_service_id === serviceId && d.source === 'auto',
      );
      if (matchingDep) await ctx.db.deleteProjectDependency(matchingDep.id);
    } catch (err) {
      log.debug({ err, projectId: project.id, serviceId }, 'Auto dependency cleanup failed');
    }

    return c.json({ message: 'Service disconnected', serviceId });
  });

  api.use('/services/:id', async (c, next) => {
    const id = c.req.param('id');
    const project = (await ctx.db.getProject(id)) ?? (await ctx.db.getProjectByName(id));
    if (project) {
      return c.redirect(`/api/projects/${project.id}/services/${project.id}`, 308);
    }
    await next();
  });

  api.get('/projects/:p/managed-services', async (c) => {
    const projectId = c.req.param('p');
    const project =
      (await ctx.db.getProject(projectId)) ?? (await ctx.db.getProjectByName(projectId));
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectId}` }, 404);
    }
    const connections = await ctx.db.listServiceConnectionsByProject(project.id);
    const services = (
      await Promise.all(connections.map((conn) => ctx.db.getService(conn.service_id_provider)))
    ).filter((svc): svc is NonNullable<typeof svc> => svc !== undefined);
    return c.json(
      services.map((svc) => {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        const svcPort = svc.assigned_port ?? svc.port;
        return {
          id: svc.id,
          name: svc.name,
          // Wire contract: emit legacy vocabulary (postgresql/mongodb).
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          type: svc.type ?? kindToLegacyType(svc.kind),
          status: svc.status,
          // Wire key preserved; canonical source: assigned_port
          port: svcPort,
          containerName: svc.container_name,
        };
      }),
    );
  });

  return api;
}
