import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import type { AppContext } from '../../app.js';
import { TunnelStartError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { encrypt } from '../../env/crypto.js';
import { getProjectUrl } from '../../pipeline/traefik.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';
import {
  getDeployableServiceRouteName,
  getDeployableServiceUrl,
  normalizeTimestamp,
} from './helpers/project-route-shared.js';
import { parseDockerLogChunk } from './helpers/docker-log-timestamps.js';
import {
  buildConnectionDependsOn,
  deriveConnectedManagedServices,
  getTopologyNodeRuntime,
  mapWithConcurrency,
  mergeDependsOn,
  registerTopologyCacheInvalidation,
  TOPOLOGY_INSPECT_CONCURRENCY,
  type TopologyNode,
} from './helpers/topology-runtime.js';
export { __test_resetTopologyNodeCache } from './helpers/topology-runtime.js';
import { gitWebhooksDisabledResponse } from './git-webhook-disabled.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';
import type { ServiceRow } from '../../db/types.js';

const log = createModuleLogger('api');

type TopologyServiceForEnvInference = Pick<
  ServiceRow,
  'id' | 'name' | 'container_id' | 'container_name'
>;

type TopologyHealth = 'healthy' | 'crashed' | 'deploying';

function addAlias(
  aliases: Map<string, string>,
  alias: string | null | undefined,
  serviceId: string,
) {
  const normalized = alias?.trim().toLowerCase();
  if (!normalized) return;
  aliases.set(normalized, serviceId);
}

function serviceAliasMap(services: TopologyServiceForEnvInference[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const service of services) {
    const displayName = deployableServiceIdToProjectId(service.name);
    const shortName = displayName.includes('/')
      ? displayName.slice(displayName.lastIndexOf('/') + 1)
      : displayName;
    addAlias(aliases, service.id, service.id);
    addAlias(aliases, displayName, service.id);
    addAlias(aliases, shortName, service.id);
    addAlias(aliases, service.container_name, service.id);
  }
  return aliases;
}

function hostAliasesFromEnvValue(value: string): string[] {
  const aliases = new Set<string>();
  if (value.includes('://')) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname) aliases.add(parsed.hostname);
    } catch {
      // Not every value containing "://" is a URL; fall through to simple matching.
    }
  }

  const plain = value.trim();
  if (/^[a-zA-Z0-9_.-]+$/.test(plain)) {
    aliases.add(plain);
  }
  return [...aliases];
}

async function inferRuntimeEnvDependencies(
  ctx: AppContext,
  services: TopologyServiceForEnvInference[],
): Promise<Map<string, string[]>> {
  const docker = (ctx as Partial<AppContext>).docker;
  if (typeof docker?.inspectContainer !== 'function') {
    return new Map();
  }

  const aliases = serviceAliasMap(services);
  const inferred = new Map<string, Set<string>>();
  for (const service of services) {
    if (!service.container_id) continue;
    try {
      const inspect = (await docker.inspectContainer(service.container_id)) as {
        Config?: { Env?: string[] };
      };
      const env = inspect.Config?.Env ?? [];
      for (const entry of env) {
        const separator = entry.indexOf('=');
        if (separator === -1) continue;
        const value = entry.slice(separator + 1);
        for (const alias of hostAliasesFromEnvValue(value)) {
          const targetId = aliases.get(alias.toLowerCase());
          if (!targetId || targetId === service.id) continue;
          const existing = inferred.get(service.id) ?? new Set<string>();
          existing.add(targetId);
          inferred.set(service.id, existing);
        }
      }
    } catch (err) {
      log.debug(
        { err, serviceId: service.id },
        'Skipping topology dependency inference from container env',
      );
    }
  }

  return new Map([...inferred.entries()].map(([serviceId, deps]) => [serviceId, [...deps]]));
}

function storedServiceStatusToTopologyHealth(status: string | null | undefined): TopologyHealth {
  if (status === 'running') return 'healthy';
  if (status === 'building') return 'deploying';
  return 'crashed';
}

export function createProjectCompatRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // One-time cache invalidation hook — when a deploy lands (success or
  // failure) the topology likely changed, so drop ALL cached node
  // runtimes for the affected project. Topology nodes for unrelated
  // projects keep their cache (keyed on container_id which is globally
  // unique).
  //
  // Module-level guard prevents duplicate subscriptions when
  // createProjectCompatRoutes is invoked multiple times (e.g. by test
  // harnesses re-mounting the routes).
  registerTopologyCacheInvalidation(ctx);

  api.get('/projects/:id/stats', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    // Project compatibility route: prefer the deployable service row for
    // status + container_id, then use ProjectRow compatibility aliases.
    const deployable = await ctx.db.getDeployableForProject(project.id);
    const status = deployable?.status ?? project.status;
    const containerId = deployable?.container_id ?? project.container_id;

    if (containerId && status === 'running') {
      try {
        const stats = (await ctx.docker.getContainerStats(containerId)) as {
          cpu_stats: {
            cpu_usage: { total_usage: number };
            system_cpu_usage: number;
            online_cpus?: number;
          };
          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
          memory_stats: { usage: number; limit: number };
        };

        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCountRaw = (stats.cpu_stats.cpu_usage as unknown as { percpu_usage?: number[] })
          .percpu_usage?.length;
        const cpuCount =
          cpuCountRaw && cpuCountRaw > 0 ? cpuCountRaw : stats.cpu_stats.online_cpus || 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

        return c.json({
          cpu: Math.round(cpuPercent * 10) / 10,
          memory: stats.memory_stats.usage,
          memoryLimit: stats.memory_stats.limit,
          status,
        });
      } catch (err) {
        log.debug({ err, projectId: project.id }, 'Container stats fetch failed');
        return c.json({
          cpu: 0,
          memory: 0,
          memoryLimit: 0,
          status,
        });
      }
    }

    return c.json({
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      status,
    });
  });

  // Phase E_NEW Task 6 — topology graph for the v4 InfraMap.
  // Returns ServiceNode[] matching web/src/lib/projectTopology.ts:
  //   { id, name, kind, image, health, port, url, cpu, mem, dependsOn }
  //
  // For compose projects the nodes are the child projects (one per
  // compose service). For standalone projects the node is the project
  // itself. `dependsOn` is derived from the `project_dependencies`
  // table (target_service_id that matches a sibling node id). Health
  // uses the same 3-state docker-inspect projection as Task 4 and then
  // collapses 'running' (no healthcheck) → 'healthy' because the UI
  // type is binary 'healthy' | 'crashed'.
  api.get('/projects/:id/topology', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    try {
      // Post-grouping: a project is a group with N deployable services.
      // List services as topology nodes. Falls back to legacy compose-child
      // projects for backward compatibility (pre-grouping data).
      // CCG perf #4 (Codex 2026-04-30): only run the legacy getChildProjects
      // path when the group has no services. The previous unconditional call
      // ran a query + N getProject() round-trips for every grouped project,
      // even though the result was discarded by useServices=true.
      const groupServices = await ctx.db.getDeployablesByGroup(project.id);
      const useServices = groupServices.length > 0;
      const childProjects = useServices
        ? []
        : typeof ctx.db.getComposeChildProjects === 'function'
          ? await ctx.db.getComposeChildProjects(project.id)
          : await ctx.db.getChildProjects(project.id);
      const groupEnvironments = useServices
        ? await ctx.db.getEnvironmentsByProject(project.id)
        : [];
      const legacyStandaloneDeployable =
        !useServices && childProjects.length === 0
          ? await ctx.db.getDeployableForProject(project.id)
          : null;
      const legacyTopologyNodes =
        childProjects.length > 0 ? childProjects : legacyStandaloneDeployable ? [project] : [];
      const { serviceConnections, connectedManagedServices } = useServices
        ? await deriveConnectedManagedServices(ctx, project.id, groupServices)
        : { serviceConnections: [], connectedManagedServices: [] };

      const nodeIds = new Set(
        useServices
          ? [...groupServices, ...connectedManagedServices].map((s) => s.id)
          : legacyTopologyNodes.map((n) => n.id),
      );

      // Build dependsOn map: for each node, find its project_dependencies
      // whose target_service_id is another node in this topology.
      const dependsOnMap = new Map<string, string[]>();
      const dependencyIdSource = useServices
        ? groupServices.map((s) => deployableServiceIdToProjectId(s.id))
        : legacyTopologyNodes.map((n) => n.id);
      for (const lookupId of dependencyIdSource) {
        const deps = await ctx.db.findDependenciesByProject(lookupId);
        const siblingDeps = deps
          .map((d) => d.target_service_id)
          .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
        const nodeId = useServices ? projectIdToDeployableServiceId(lookupId) : lookupId;
        dependsOnMap.set(nodeId, siblingDeps);
      }
      if (useServices) {
        mergeDependsOn(dependsOnMap, buildConnectionDependsOn(serviceConnections, nodeIds));
        mergeDependsOn(dependsOnMap, await inferRuntimeEnvDependencies(ctx, groupServices));
      }

      // Determine kind: 'Database' for known db service types, else 'Application'
      function resolveKind(kindOrName: string): 'Application' | 'Database' {
        const lower = kindOrName.toLowerCase();
        if (/postgres|mysql|mariadb|mongo|redis|sqlite|clickhouse|minio/.test(lower)) {
          return 'Database';
        }
        return 'Application';
      }

      // Inspect health for all nodes — funneled through per-container 15s
      // TTL cache + in-flight dedupe + a 6-wide concurrency limiter so a
      // 30-node group doesn't open 60 simultaneous Docker calls.
      const serviceNodes = useServices
        ? [
            ...(await mapWithConcurrency(
              groupServices,
              TOPOLOGY_INSPECT_CONCURRENCY,
              async (svc) => {
                const port = svc.assigned_port ?? null;
                // Display name strips __svc suffix and group-name prefix.
                const displayName = deployableServiceIdToProjectId(svc.name);
                const url = getDeployableServiceUrl(svc);
                const image = svc.image_url ?? svc.image_tag ?? `${displayName}:latest`;
                const kind = 'Application' as const;
                const runtime = await getTopologyNodeRuntime(ctx, {
                  id: svc.id,
                  container_id: svc.container_id,
                  status: svc.status ?? null,
                });
                return {
                  id: svc.id,
                  name: displayName,
                  kind,
                  image,
                  health: runtime.health,
                  port,
                  url,
                  cpu: runtime.cpuDisplay,
                  mem: runtime.memDisplay,
                  dependsOn: dependsOnMap.get(svc.id) ?? [],
                  source: svc.source,
                  repoUrl: svc.repo_url,
                  branch: svc.branch,
                  deployedBranch:
                    groupEnvironments.find(
                      (env) => env.service_id === svc.id && env.type === 'production',
                    )?.branch ?? null,
                  dockerfilePath: svc.dockerfile_path,
                  dockerTarget: svc.docker_target,
                  buildContext: svc.build_context,
                  buildMethod: svc.build_method,
                  routeName: getDeployableServiceRouteName(svc),
                };
              },
            )),
            ...connectedManagedServices.map((svc) => {
              const port = svc.assigned_port ?? null;
              const image = svc.image_url ?? svc.image_tag ?? `${svc.name}:latest`;
              return {
                id: svc.id,
                name: svc.name,
                kind: resolveKind(`${svc.kind} ${svc.name} ${image}`),
                image,
                health: storedServiceStatusToTopologyHealth(svc.status ?? null),
                port,
                url: null,
                cpu: '—',
                mem: '—',
                dependsOn: [],
                source: 'managed',
                repoUrl: svc.repo_url,
                branch: svc.branch,
                deployedBranch: null,
                dockerfilePath: svc.dockerfile_path,
                dockerTarget: svc.docker_target,
                buildContext: svc.build_context,
                buildMethod: svc.build_method,
                routeName: svc.name,
                containerPort: svc.container_port,
                imageUrl: svc.image_url,
                imageCmd: svc.image_cmd,
              };
            }),
          ]
        : await mapWithConcurrency(
            legacyTopologyNodes,
            TOPOLOGY_INSPECT_CONCURRENCY,
            async (node) => {
              const deployable =
                childProjects.length === 0 && node.id === project.id
                  ? legacyStandaloneDeployable
                  : await ctx.db.getDeployableForProject(node.id);
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
            },
          );

      return c.json({ services: serviceNodes });
    } catch (err) {
      log.debug({ err, projectId: project.id }, 'Get project topology failed');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Project not found')) {
        return c.json({ error: 'NOT_FOUND', message: `Project not found: ${project.id}` }, 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch project topology' }, 500);
    }
  });

  // --- Deployment History ---

  // v0.2.3: Start a stopped project
  api.post('/projects/:id/start', (c) => {
    return c.json(
      {
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
        message:
          'Project-level runtime actions were removed. Use the canonical service endpoint instead.',
        replacement: 'POST /api/projects/:projectId/services/:serviceId/start',
      },
      410,
    );
  });

  api.post('/projects/:id/stop', (c) => {
    return c.json(
      {
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
        message:
          'Project-level runtime actions were removed. Use the canonical service endpoint instead.',
        replacement: 'POST /api/projects/:projectId/services/:serviceId/stop',
      },
      410,
    );
  });

  api.post('/projects/:id/redeploy', (c) => {
    return c.json(
      {
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
        message:
          'Project-level runtime actions were removed. Use the canonical service endpoint instead.',
        replacement: 'POST /api/projects/:projectId/services/:serviceId/deploy',
      },
      410,
    );
  });

  api.post('/projects/:id/rollback', (c) => {
    return c.json(
      {
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
        message:
          'Project-level runtime actions were removed. Use the canonical service endpoint instead.',
        replacement: 'POST /api/projects/:projectId/services/:serviceId/rollback',
      },
      410,
    );
  });

  api.post('/projects/:id/blue-green', (c) => {
    return c.json(
      {
        error: 'PROJECT_RUNTIME_ACTION_REMOVED',
        code: 'PROJECT_RUNTIME_ACTION_REMOVED',
        message:
          'Project-level runtime actions were removed. Use the canonical service endpoint instead.',
        replacement: 'POST /api/projects/:projectId/services/:serviceId/deploy?strategy=blue-green',
      },
      410,
    );
  });

  api.get('/projects/:id/webhooks', (c) => gitWebhooksDisabledResponse(c));
  api.post('/projects/:id/webhooks', (c) => gitWebhooksDisabledResponse(c));
  api.delete('/projects/:id/webhooks/:source', (c) => gitWebhooksDisabledResponse(c));

  // v0.3: Build error debugging

  // v0.4: Preview deployments
  api.post('/previews/deploy', async (c) => {
    const body = await c.req.json<{
      repo_url: string;
      branch: string;
      project_id?: string;
      ttl_ms?: number;
    }>();
    if (!body.repo_url || !body.branch) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url and branch are required' }, 400);
    }
    const result = await ctx.previewDeployer.deploy({
      repoUrl: body.repo_url,
      branch: body.branch,
      projectId: body.project_id,
      ttlMs: body.ttl_ms,
      sshKeyPath: ctx.config.git.sshKeyPath || undefined,
    });
    return c.json(result, result.success ? 200 : 500);
  });

  api.get('/previews', (c) => {
    const previews = ctx.previewDeployer.list();
    return c.json({
      count: previews.length,
      previews: previews.map((p) => ({
        branch: p.branch,
        url: p.url,
        port: p.port,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  api.delete('/previews/:id', async (c) => {
    const previewId = c.req.param('id');
    await ctx.previewDeployer.cleanup(previewId);
    return c.json({ status: 'cleaned_up', previewId });
  });

  // --- v0.0.11: Insight action handlers ---

  api.post('/projects/:id/actions', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ action: string }>().catch(() => ({ action: '' }));
    const { action } = body;

    switch (action) {
      case 'cleanup_stale': {
        // Remove old containers for this project (keep the current one).
        // Project compatibility route: prefer deployable service row's
        // container_id, then use ProjectRow compatibility aliases.
        const deployable = await ctx.db.getDeployableForProject(project.id);
        const currentContainerId = deployable?.container_id ?? project.container_id;
        const managed = await ctx.docker.listManagedContainers();
        const stale = managed.filter(
          (c) =>
            c.name.startsWith(project.name) &&
            c.id !== currentContainerId &&
            c.status === 'running',
        );
        for (const container of stale) {
          try {
            await ctx.docker.stopContainer(container.id);
            await ctx.docker.removeContainer(container.id);
          } catch (err) {
            log.warn({ err, containerId: container.id }, 'Failed to remove stale container');
          }
        }
        return c.json({ status: 'ok', action, removed: stale.length });
      }

      case 'view_logs': {
        // Return a redirect hint — frontend navigates to logs tab
        return c.json({ status: 'ok', action, redirect: 'logs' });
      }

      case 'retry_healthcheck': {
        const result = await ctx.projectHealthMonitor.checkProject(project.id);
        return c.json({
          status: 'ok',
          action,
          healthy: result.healthy,
          responseTimeMs: result.responseTimeMs,
        });
      }

      default:
        return c.json({ status: 'error', message: `Unknown action: ${action}` }, 400);
    }
  });

  api.get('/projects/:id/logs', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const follow = c.req.query('follow');

    // PR 4 canonical-first: container_id from deployable services row.
    const deployable = await ctx.db.getDeployableForProject(project.id);
    const followContainerId = deployable?.container_id ?? project.container_id;
    if (follow && followContainerId) {
      const containerId = followContainerId;
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
            // Stream will be cleaned up automatically on abort
          });
        } catch (err) {
          log.debug({ err, projectId: project.id }, 'Log streaming failed');
          void s.write(JSON.stringify({ error: 'Failed to stream logs' }) + '\n');
          void s.close();
        }
      });
    }

    const lines = parseInt(c.req.query('lines') ?? '50', 10);
    const logs = await ctx.pipeline.getLogs(project.id, lines, { timestamps: true });

    return c.json({ project: project.name, logs });
  });

  api.post('/question/reply', async (c) => {
    const body = await c.req
      .json<{
        request_id?: unknown;
        requestId?: unknown;
        answers?: Array<{
          questionIndex?: unknown;
          selectedLabels?: unknown;
          customText?: unknown;
        }>;
      }>()
      .catch(() => ({
        request_id: undefined,
        requestId: undefined,
        answers: undefined,
      }));

    const requestId = body.request_id || body.requestId;
    if (typeof requestId !== 'string' || requestId.trim() === '') {
      return c.json({ error: 'MISSING_FIELD', message: 'request_id is required' }, 400);
    }

    const answers = body.answers;

    if (!Array.isArray(answers)) {
      return c.json({ error: 'MISSING_FIELD', message: 'answers array is required' }, 400);
    }

    for (const answer of answers) {
      if (typeof answer !== 'object') {
        return c.json({ error: 'INVALID_ANSWER', message: 'Each answer must be an object' }, 400);
      }

      const normalized = answer;

      const isValidQuestionIndex =
        typeof normalized.questionIndex === 'number' &&
        Number.isInteger(normalized.questionIndex) &&
        normalized.questionIndex >= 0;
      const isValidSelectedLabels =
        Array.isArray(normalized.selectedLabels) &&
        normalized.selectedLabels.every((value) => typeof value === 'string');
      const isValidCustomText =
        normalized.customText === undefined || typeof normalized.customText === 'string';

      if (!isValidQuestionIndex || !isValidSelectedLabels || !isValidCustomText) {
        return c.json(
          {
            error: 'INVALID_ANSWER',
            message:
              'Each answer must include questionIndex, selectedLabels, and optional customText',
          },
          400,
        );
      }
    }

    if (!ctx.questionBridge.hasPending()) {
      return c.json(
        { error: 'NO_PENDING_QUESTION', message: 'No pending question to answer' },
        409,
      );
    }

    const normalizedAnswers = answers.map((answer) => {
      const normalized = answer as {
        questionIndex: number;
        selectedLabels: string[];
        customText?: string;
      };

      return {
        questionIndex: normalized.questionIndex,
        selectedLabels: normalized.selectedLabels,
        customText: normalized.customText,
      };
    });

    ctx.questionBridge.reply(requestId, normalizedAnswers);

    return c.json({ status: 'answered' });
  });

  api.post('/question/dismiss', async (c) => {
    await c.req
      .json<{ request_id?: string; requestId?: string }>()
      .catch(() => ({ request_id: undefined, requestId: undefined }));

    if (!ctx.questionBridge.hasPending()) {
      return c.json(
        { error: 'NO_PENDING_QUESTION', message: 'No pending question to dismiss' },
        409,
      );
    }

    ctx.questionBridge.reject();
    return c.json({ status: 'dismissed' });
  });

  api.post('/projects/:id/expose', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    // PR 4 canonical-first: assigned_port from deployable services row.
    const deployable = await ctx.db.getDeployableForProject(project.id);
    const exposePort = deployable?.assigned_port ?? project.assigned_port;
    if (!exposePort) {
      return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
    }

    try {
      const url = await ctx.pipeline.exposeTunnel(project.id, exposePort);
      return c.json({ status: 'exposed', project: project.name, publicUrl: url });
    } catch (error) {
      if (error instanceof TunnelStartError) {
        return c.json(
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

  api.post('/projects/:id/unexpose', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    ctx.pipeline.closeTunnel(project.id);
    return c.json({ status: 'unexposed', project: project.name });
  });

  api.post('/projects/:id/share', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ accessCode: string }>();
    if (!body.accessCode || body.accessCode.length < 4) {
      return c.json(
        {
          error: 'INVALID_ACCESS_CODE',
          message: 'Access code must be at least 4 characters',
        },
        400,
      );
    }

    const { encrypted, iv } = encrypt(body.accessCode);

    // PR 4 canonical-first: assigned_port from deployable services row.
    const shareDeployable = await ctx.db.getDeployableForProject(project.id);
    const sharePort = shareDeployable?.assigned_port ?? project.assigned_port;
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    if (project.visibility !== 'quick-share' && project.visibility !== 'shared') {
      if (!sharePort) {
        return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        await ctx.pipeline.exposeTunnel(project.id, sharePort);
      } catch (error) {
        if (error instanceof TunnelStartError) {
          return c.json(
            {
              error: 'TUNNEL_START_FAILED',
              message: 'Cloudflare service is temporarily unavailable. Please try again.',
            },
            503,
          );
        }
        throw error;
      }
    }

    let tunnel = ctx.pipeline.getTunnel(project.id);
    if (!tunnel) {
      const assignedPort = sharePort;
      if (!assignedPort) {
        return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        await ctx.pipeline.exposeTunnel(project.id, assignedPort);
      } catch (error) {
        if (error instanceof TunnelStartError) {
          return c.json(
            {
              error: 'TUNNEL_START_FAILED',
              message: 'Cloudflare service is temporarily unavailable. Please try again.',
            },
            503,
          );
        }
        throw error;
      }
      tunnel = ctx.pipeline.getTunnel(project.id);
    }

    if (!tunnel) {
      return c.json(
        {
          error: 'TUNNEL_UNAVAILABLE',
          message: 'Failed to initialize quick-share tunnel',
        },
        500,
      );
    }

    tunnel.enableSharedMode(project.name, body.accessCode);

    await ctx.db.updateProject(project.id, {
      visibility: 'shared',
      accessCode: encrypted,
      accessCodeIv: iv,
    });

    const updatedProject = await ctx.db.getProject(project.id);
    // PR 4 canonical-first: public_url from deployable services row.
    const updatedDeployable = updatedProject
      ? await ctx.db.getDeployableForProject(updatedProject.id)
      : undefined;
    return c.json({
      status: 'shared',
      project: project.name,
      publicUrl: updatedDeployable?.public_url ?? updatedProject?.public_url,
    });
  });

  api.delete('/projects/:id/share', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const tunnel = ctx.pipeline.getTunnel(project.id);
    if (tunnel) {
      tunnel.disableSharedMode(project.name);
    }

    await ctx.db.updateProject(project.id, {
      visibility: 'quick-share',
      accessCode: null,
      accessCodeIv: null,
    });

    return c.json({ status: 'unshared', project: project.name });
  });

  api.get('/projects/:id/previews', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const previews = await ctx.db.getPreviewProjects(project.id);
    return c.json({
      previews: await Promise.all(
        previews.map(async (preview) => {
          // PR 4 canonical-first: status + public_url from each preview's
          // deployable services row when available; fall back to legacy
          // projects columns through migration 0012.
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

  api.delete('/projects/:id/previews/:previewId', async (c) => {
    const previewId = c.req.param('previewId');
    const project = await getProjectOrThrow(c, ctx);

    // PR 4 canonical-first (Codex CCG flagged): resolve preview's parent
    // via the services hierarchy first (parent_service_id stripped of
    // `__svc` suffix → parent project id), fall back to the legacy
    // projects.parent_project_id column through migration 0012.
    const preview = await ctx.db.getProject(previewId);
    const previewService = preview
      ? await ctx.db.getService(projectIdToDeployableServiceId(previewId))
      : undefined;
    const previewParentId =
      (previewService?.parent_service_id
        ? deployableServiceIdToProjectId(previewService.parent_service_id)
        : null) ?? preview?.parent_project_id;
    if (!preview || previewParentId !== project.id) {
      return c.json({ error: 'PREVIEW_NOT_FOUND', message: 'Preview not found' }, 404);
    }

    await ctx.pipeline.remove(previewId, ctx.cloudflare);
    return c.json({ status: 'removed', preview: preview.name });
  });

  // ---------------------------------------------------------------------------
  // Deprecated-endpoint middleware (rc.1)
  // Adds X-Deprecated-Endpoint to all legacy /projects/:id/* responses so API
  // consumers can discover and migrate to the canonical vocabulary before 2.0.
  // Applies only to routes matched under /projects/:id/... so POST /projects
  // (create) and GET /projects (list) are deliberately excluded.
  // ---------------------------------------------------------------------------

  return api;
}
