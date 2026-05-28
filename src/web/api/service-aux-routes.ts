import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import { TunnelStartError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getProjectUrl } from '../../pipeline/traefik.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import {
  getDeployableServiceRouteName,
  getDeployableServiceUrl,
  normalizeTimestamp,
} from './helpers/project-route-shared.js';
import { gitWebhooksDisabledResponse } from './git-webhook-disabled.js';
import {
  buildConnectionDependsOn,
  deriveConnectedManagedServices,
  getTopologyNodeRuntime,
  mergeDependsOn,
  storedServiceStatusToTopologyHealth,
  type TopologyNode,
} from './helpers/topology-runtime.js';
import { computeContainerCpuPercent, type ContainerStatsRaw } from '../../pipeline/docker.js';

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
      const deployable = await ctx.db.getDeployableForProject(project.id);
      const status = deployable?.status ?? project.status;
      const containerId = deployable?.container_id ?? project.container_id;
      if (containerId && status === 'running') {
        return ctx.docker
          .getContainerStats(containerId)
          .then((stats) => {
            const s = stats as ContainerStatsRaw;
            const cpuCountRaw = s.cpu_stats.cpu_usage.percpu_usage?.length;
            const cpuCount =
              cpuCountRaw && cpuCountRaw > 0 ? cpuCountRaw : s.cpu_stats.online_cpus || 1;
            const cpuPercent = computeContainerCpuPercent(s, cpuCount);
            return cx.json({
              cpu: Math.round(cpuPercent * 10) / 10,
              memory: s.memory_stats.usage,
              memoryLimit: s.memory_stats.limit,
              status,
            });
          })
          .catch(() => cx.json({ cpu: 0, memory: 0, memoryLimit: 0, status }));
      }
      return Promise.resolve(cx.json({ cpu: 0, memory: 0, memoryLimit: 0, status }));
    });
  });

  api.get('/projects/:p/services/:s/topology', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      try {
        const groupServices =
          typeof ctx.db.getDeployablesByGroup === 'function'
            ? await ctx.db.getDeployablesByGroup(project.id)
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
        function resolveKind(name: string): 'Application' | 'Database' {
          const lower = name.toLowerCase();
          if (/postgres|mysql|mariadb|mongo|redis|sqlite|clickhouse|minio/.test(lower)) {
            return 'Database';
          }
          return 'Application';
        }
        const serviceNodes = await Promise.all(
          nodes.map(async (node) => {
            const deployable = await ctx.db.getDeployableForProject(node.id);
            const port = deployable?.assigned_port ?? node.assigned_port ?? null;
            const url = port ? getProjectUrl(node.name) : null;
            const image =
              deployable?.image_url ??
              node.image_url ??
              deployable?.image_tag ??
              node.image_tag ??
              `${node.name}:latest`;
            const kind = resolveKind(node.name);
            const runtimeNode: TopologyNode = {
              id: deployable?.id ?? projectIdToDeployableServiceId(node.id),
              container_id: deployable?.container_id ?? node.container_id,
              status: deployable?.status ?? node.status ?? null,
            };
            const runtime = await getTopologyNodeRuntime(ctx, runtimeNode);
            return {
              id: node.id,
              name: node.name,
              kind,
              image,
              health: runtime.health,
              port,
              url,
              cpu: runtime.cpuDisplay,
              mem: runtime.memDisplay,
              dependsOn: dependsOnMap.get(node.id) ?? [],
            };
          }),
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
      const deployable = await ctx.db.getDeployableForProject(project.id);
      const exposePort = deployable?.assigned_port ?? project.assigned_port;
      if (!exposePort) {
        return cx.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        const url = await ctx.pipeline.exposeTunnel(project.id, exposePort);
        return cx.json({ status: 'exposed', project: project.name, publicUrl: url });
      } catch (error) {
        if (error instanceof TunnelStartError) {
          return cx.json(
            {
              error: 'TUNNEL_START_FAILED',
              message: 'Cloudflare service is temporarily unavailable. Please try again.',
            },
            503,
          );
        }
        throw error;
      }
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
      const previews = await ctx.db.getPreviewProjects(project.id);
      return cx.json({
        previews: await Promise.all(
          previews.map(async (preview) => {
            const deployable = await ctx.db.getDeployableForProject(preview.id);
            return {
              id: preview.id,
              name: preview.name,
              status: deployable?.status ?? preview.status,
              prNumber: preview.pr_number,
              url: getProjectUrl(preview.name),
              publicUrl: deployable?.public_url ?? preview.public_url,
              createdAt: normalizeTimestamp(preview.created_at),
              updatedAt: normalizeTimestamp(preview.updated_at),
            };
          }),
        ),
      });
    });
  });

  return api;
}
