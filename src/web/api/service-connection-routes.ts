import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { ManagedServiceLinker } from '../../pipeline/managed-service-linker.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

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

    const linker = new ManagedServiceLinker(ctx.db, ctx.env);
    const linked = await linker.connect({
      projectId: project.id,
      service,
      source: 'web',
      credentials: parseServiceCredentials(service.credentials),
      // Standalone REST connect: defer wiring for an empty group (no workload to
      // consume) rather than fabricate a phantom `<projectId>__svc` consumer.
      deferIfNoWorkload: true,
    });
    const connection = await ctx.db.getServiceConnectionByProjectAndService(
      linked.resolvedProjectId,
      serviceId,
    );

    // Wire contract: emit legacy vocabulary (postgresql/mongodb) for back-compat.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const serviceKind = service.type ?? kindToLegacyType(service.kind);
    return c.json(
      {
        status: connection ? 'connected' : 'deferred',
        id: connection?.id ?? null,
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
        createdAt: connection?.created_at ?? null,
        autoInjectedEnvKeys: linked.autoInjectedEnvKeys,
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

    await new ManagedServiceLinker(ctx.db, ctx.env).disconnect({
      projectId: project.id,
      serviceId,
    });

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
    const directManagedServices = await ctx.db.getServices({
      project_id: project.id,
      kindIn: MANAGED_SERVICE_KINDS,
    });
    const connections = await ctx.db.listServiceConnectionsByProject(project.id);
    const servicesById = new Map(directManagedServices.map((svc) => [svc.id, svc]));
    const connectedServices = (
      await Promise.all(connections.map((conn) => ctx.db.getService(conn.service_id_provider)))
    ).filter((svc): svc is NonNullable<typeof svc> => svc !== undefined);
    for (const service of connectedServices) {
      servicesById.set(service.id, service);
    }
    const services = [...servicesById.values()];
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
