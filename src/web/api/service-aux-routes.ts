import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppContext } from '../../app.js';
import { TunnelStartError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getProjectUrl } from '../../pipeline/traefik.js';
import { projectIdToDeployableServiceId } from '../../db/service-ids.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import { normalizeTimestamp } from './helpers/project-route-shared.js';
import { gitWebhooksDisabledResponse } from './git-webhook-disabled.js';
import { getTopologyNodeRuntime, type TopologyNode } from './helpers/topology-runtime.js';

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
            const s = stats as {
              cpu_stats: {
                cpu_usage: { total_usage: number };
                system_cpu_usage: number;
                online_cpus?: number;
              };
              precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
              memory_stats: { usage: number; limit: number };
            };
            const cpuDelta =
              s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
            const systemDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
            const cpuCountRaw = (s.cpu_stats.cpu_usage as unknown as { percpu_usage?: number[] })
              .percpu_usage?.length;
            const cpuCount =
              cpuCountRaw && cpuCountRaw > 0 ? cpuCountRaw : s.cpu_stats.online_cpus || 1;
            const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
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
        const childProjects =
          typeof ctx.db.getComposeChildProjects === 'function'
            ? await ctx.db.getComposeChildProjects(project.id)
            : await ctx.db.getChildProjects(project.id);
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
