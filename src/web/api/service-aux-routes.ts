import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import { createModuleLogger } from '../../lib/logger.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import {
  getDeployableServiceRouteName,
  getDeployableServiceUrl,
} from './helpers/project-route-shared.js';
import { exposeProjectTunnel } from './helpers/expose-tunnel.js';
import { loadPreviewProjections } from './helpers/preview-projection.js';
import { gitWebhooksDisabledResponse } from './git-webhook-disabled.js';
import {
  buildConnectionDependsOn,
  buildLegacyTopologyNode,
  deriveConnectedManagedServices,
  getTopologyNodeRuntime,
  mergeDependsOn,
  storedServiceStatusToTopologyHealth,
  type TopologyNode,
} from './helpers/topology-runtime.js';
import { loadProjectRuntimeStats } from './helpers/service-runtime-stats.js';

const log = createModuleLogger('api:service-aux');

function withServiceAsId<T>(c: Context, fn: (c: Context) => T): T {
  const origParam = c.req.param.bind(c.req);
  const projectId = (origParam as (name: string) => string)('p');
  c.req.param = ((name?: string) => {
    if (name === 'id') return projectId;
    if (name === undefined) {
      const all = (origParam as () => Record<string, string>)();
      return { ...all, id: projectId };
    }
    return (origParam as (n: string) => string)(name);
  }) as typeof c.req.param;
  return fn(c);
}

export function createServiceAuxRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:p/services/:s/stats', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      return cx.json(await loadProjectRuntimeStats(ctx, project));
    });
  });

  api.get('/projects/:p/services/:s/topology', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      try {
        const groupServices =
          typeof ctx.db.getDeployablesByGroup === 'function'
            ? (await ctx.db.getDeployablesByGroup(project.id)).filter(
                (service) => !service.archived_at,
              )
            : [];
        const childProjects =
          groupServices.length > 0
            ? []
            : typeof ctx.db.getComposeChildProjects === 'function'
              ? await ctx.db.getComposeChildProjects(project.id)
              : await ctx.db.getChildProjects(project.id);
        if (groupServices.length > 0) {
          const { serviceConnections, connectedManagedServices } =
            await deriveConnectedManagedServices(ctx, project.id, groupServices);

          const nodeIds = new Set(
            [...groupServices, ...connectedManagedServices].map((service) => service.id),
          );
          const dependsOnMap = new Map<string, string[]>();
          for (const service of groupServices) {
            const lookupId = deployableServiceIdToProjectId(service.id);
            const deps = await ctx.db.findDependenciesByProject(lookupId);
            const siblingDeps = deps
              .map((d) => d.target_service_id)
              .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
            dependsOnMap.set(service.id, siblingDeps);
          }

          mergeDependsOn(dependsOnMap, buildConnectionDependsOn(serviceConnections, nodeIds));

          const deployableNodes = await Promise.all(
            groupServices.map(async (service) => {
              const port = service.assigned_port ?? null;
              const displayName = deployableServiceIdToProjectId(service.name);
              const image = service.image_url ?? service.image_tag ?? `${displayName}:latest`;
              const runtimeNode: TopologyNode = {
                id: service.id,
                container_id: service.container_id,
                status: service.status ?? null,
              };
              const runtime = await getTopologyNodeRuntime(ctx, runtimeNode);
              return {
                id: service.id,
                name: displayName,
                kind: 'Application',
                image,
                health: runtime.health,
                port,
                url: getDeployableServiceUrl(service),
                cpu: runtime.cpuDisplay,
                mem: runtime.memDisplay,
                dependsOn: dependsOnMap.get(service.id) ?? [],
                source: service.source,
                routeName: getDeployableServiceRouteName(service),
              };
            }),
          );

          return cx.json({
            services: [
              ...deployableNodes,
              ...connectedManagedServices.map((service) => {
                const port = service.assigned_port ?? null;
                const image = service.image_url ?? service.image_tag ?? `${service.name}:latest`;
                return {
                  id: service.id,
                  name: service.name,
                  kind: 'Database',
                  image,
                  health: storedServiceStatusToTopologyHealth(service.status ?? null),
                  port,
                  url: null,
                  cpu: '—',
                  mem: '—',
                  dependsOn: [],
                  source: 'managed',
                  routeName: service.name,
                  containerPort: service.container_port,
                  imageUrl: service.image_url,
                  imageCmd: service.image_cmd,
                };
              }),
            ],
          });
        }

        const nodes = childProjects.length > 0 ? childProjects : [project];
        const nodeIds = new Set(nodes.map((n) => n.id));
        const dependsOnMap = new Map<string, string[]>();
        for (const node of nodes) {
          const deps = await ctx.db.findDependenciesByProject(node.id);
          const siblingDeps = deps
            .map((d) => d.target_service_id)
            .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
          dependsOnMap.set(node.id, siblingDeps);
        }
        const serviceNodes = await Promise.all(
          nodes.map((node) => buildLegacyTopologyNode(ctx, node, { dependsOnMap })),
        );
        return cx.json({ services: serviceNodes });
      } catch (err) {
        log.debug({ err, projectId: project.id }, 'Get project topology failed (canonical path)');
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Project not found')) {
          return Promise.resolve(
            cx.json({ error: 'NOT_FOUND', message: `Project not found: ${project.id}` }, 404),
          );
        }
        return Promise.resolve(
          cx.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch project topology' }, 500),
        );
      }
    });
  });

  api.post('/projects/:p/services/:s/expose', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      const outcome = await exposeProjectTunnel(ctx, project);
      if (outcome.kind === 'not-running') {
        return cx.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      if (outcome.kind === 'tunnel-failed') {
        return cx.json(
          {
            error: 'TUNNEL_START_FAILED',
            message: 'Cloudflare service is temporarily unavailable. Please try again.',
          },
          503,
        );
      }
      return cx.json({ status: 'exposed', project: project.name, publicUrl: outcome.publicUrl });
    });
  });

  api.post('/projects/:p/services/:s/unexpose', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      ctx.pipeline.closeTunnel(project.id);
      return cx.json({ status: 'unexposed', project: project.name });
    });
  });

  api.get('/projects/:p/services/:s/webhooks', (c) => gitWebhooksDisabledResponse(c));
  api.post('/projects/:p/services/:s/webhooks', (c) => gitWebhooksDisabledResponse(c));

  api.get('/projects/:p/services/:s/previews', (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      return cx.json({ previews: await loadPreviewProjections(ctx, project.id) });
    });
  });

  return api;
}
