import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { rm } from 'node:fs/promises';

import type { AppContext } from '../../app.js';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  OpenLanderError,
  ProjectArchivedError,
  ProjectRecoveringError,
  TunnelStartError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { encrypt } from '../../env/crypto.js';
import {
  getProjectUrl,
  getProjectUrls,
  getAllIps,
  getEnvironmentProjectHostname,
} from '../../pipeline/traefik.js';
import { cloneRepo } from '../../pipeline/git.js';
import { scanForEnvUsage } from '../../pipeline/env-scan.js';
import {
  autoInjectServiceEnv,
  cleanupAutoInjectedEnv,
  generateEnvExample,
} from '../../pipeline/env-inject.js';
import type { EnvironmentRow, ProjectRow } from '../../db/index.js';
import {
  assertProjectLifecycleMutable,
  assertProjectMutable,
} from '../../pipeline/mutation-policy.js';
import {
  getEnvironmentByIdOrThrow,
  getProjectOrThrow,
  resolveEnvironmentByType,
} from './helpers/project-helpers.js';

const log = createModuleLogger('api');

// ---------------------------------------------------------------------------
// Topology per-node cache (Phase 4 fix — Blocker 4)
// ---------------------------------------------------------------------------
//
// /api/projects/:id/topology used to fire `Promise.all([getContainerStats,
// inspectContainer])` for EVERY service on EVERY poll, with no caching and
// no in-flight de-dupe. A 10-service compose project = 20 Docker daemon
// calls per topology poll, multiplied by however many UI tabs are open.
//
// Fix: a per-`container_id` 15s TTL cache + in-flight dedupe, mirroring the
// pattern at ServiceManager.listWithCardSummary
// (`serviceCardSummaryCache` + `serviceCardSummaryInFlight`). Concurrent
// callers asking for the same container collapse to a single Docker call;
// repeat callers within 15s reuse the cached value entirely.
//
// Module-level Maps are intentional — keyed on container_id which is
// globally unique across projects, so cache reuse is safe across tenants.

interface TopologyNodeRuntime {
  health: 'healthy' | 'crashed';
  cpuDisplay: string;
  memDisplay: string;
}

const TOPOLOGY_NODE_CACHE_TTL_MS = 15_000;
const topologyNodeCache = new Map<string, { ts: number; value: TopologyNodeRuntime }>();
const topologyNodeInFlight = new Map<string, Promise<TopologyNodeRuntime>>();

function invalidateTopologyNodeCache(containerId: string | null | undefined): void {
  if (!containerId) return;
  topologyNodeCache.delete(containerId);
}

/**
 * Test-only escape hatch. Vitest module isolation gives each test file a
 * fresh module graph, but tests that exercise the cache within a single
 * file want a clean slate per case. Exported with a deliberate
 * `__test_` prefix to signal "do not use from production code".
 */
export function __test_resetTopologyNodeCache(): void {
  topologyNodeCache.clear();
  topologyNodeInFlight.clear();
}

interface TopologyNode {
  container_id: string | null;
  status: string | null;
}

const topologyCacheInvalidationRegistered = new WeakSet<object>();

function registerTopologyCacheInvalidation(ctx: AppContext): void {
  // Defensive: test fixtures may construct AppContext without an eventBus
  // at all, or mock it with `.emit` only and omit `.on`. The cache
  // invalidation hook is a perf optimization, not a correctness
  // requirement (15s TTL still bounds staleness), so silently skip
  // subscription when the bus or `.on` is unavailable. Production
  // EventBus (src/events/index.ts) provides both methods.
  const bus = ctx.eventBus as { on?: unknown; emit?: unknown } | undefined;
  if (!bus || typeof bus.on !== 'function') {
    return;
  }

  // Re-mounting routes (e.g. test harness) must not stack subscribers.
  // Guard on the eventBus identity so each bus only registers once.
  if (topologyCacheInvalidationRegistered.has(ctx.eventBus)) {
    return;
  }
  topologyCacheInvalidationRegistered.add(ctx.eventBus);

  const invalidateProjectContainers = (projectId: string): void => {
    try {
      const project = ctx.db.getProject(projectId);
      if (project) {
        invalidateTopologyNodeCache(project.container_id);
      }
      // getChildProjects is a Database method but some narrow test
      // fixtures stub `db` with only the methods they exercise — guard
      // so the optional cache lookup never crashes the subscription.
      if (typeof ctx.db.getChildProjects === 'function') {
        const children = ctx.db.getChildProjects(projectId);
        for (const child of children) {
          invalidateTopologyNodeCache(child.container_id);
        }
      }
    } catch (err) {
      log.debug({ err, projectId }, 'topology cache invalidation lookup failed');
    }
  };

  ctx.eventBus.on('deploy:success', (payload) => {
    invalidateProjectContainers(payload.projectId);
  });
  ctx.eventBus.on('deploy:failed', (payload) => {
    invalidateProjectContainers(payload.projectId);
  });
}

async function fetchTopologyNodeRuntime(
  ctx: Pick<AppContext, 'docker'>,
  node: TopologyNode,
): Promise<TopologyNodeRuntime> {
  let cpuDisplay = '—';
  let memDisplay = '—';

  if (node.container_id && node.status === 'running') {
    try {
      const rawStats = (await ctx.docker.getContainerStats(node.container_id)) as {
        cpu_stats: {
          cpu_usage: { total_usage: number; percpu_usage?: number[] };
          system_cpu_usage: number;
          online_cpus?: number;
        };
        precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
        memory_stats: { usage?: number; limit?: number };
      };

      const cpuDelta =
        rawStats.cpu_stats.cpu_usage.total_usage - rawStats.precpu_stats.cpu_usage.total_usage;
      const systemDelta =
        rawStats.cpu_stats.system_cpu_usage - rawStats.precpu_stats.system_cpu_usage;
      const cpuCountRaw = rawStats.cpu_stats.cpu_usage.percpu_usage?.length;
      const cpuCount =
        cpuCountRaw && cpuCountRaw > 0 ? cpuCountRaw : (rawStats.cpu_stats.online_cpus ?? 1);
      const cpuPct =
        systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * cpuCount * 1000) / 10 : 0;
      cpuDisplay = `${String(cpuPct)}%`;

      const memBytes = rawStats.memory_stats.usage ?? 0;
      if (memBytes > 0) {
        const memMb = Math.round(memBytes / (1024 * 1024));
        memDisplay = `${String(memMb)} MB`;
      }
    } catch {
      // stats unavailable — display stays '—'
    }
  }

  // Determine health using docker inspect (same projection as Task 4).
  //
  // Phase 4 fix (Blocker 3): preserve `starting` as `healthy`.
  // Containers in their HEALTHCHECK `start_period` (typically 30s for
  // postgres/mongo) are healthy by default — collapsing `starting` to
  // `crashed` triggered false alarms in InfraMap on every fresh deploy.
  // Only `unhealthy` collapses to `crashed`. `null` (no healthcheck)
  // and `healthy` keep the default `healthy`.
  //
  // Inspect failure collapses to `crashed` for parity with
  // ServiceManager.inspectServiceContainer (which sets status: 'error'
  // on the same failure mode).
  let health: 'healthy' | 'crashed' = 'healthy';
  if (node.status !== 'running') {
    health = 'crashed';
  } else if (node.container_id) {
    try {
      const info = await ctx.docker.inspectContainer(node.container_id);
      const dockerHealth =
        (info as unknown as { State: { Health?: { Status?: string } } }).State.Health?.Status ??
        null;
      if (dockerHealth === 'unhealthy') {
        health = 'crashed';
      }
    } catch {
      health = 'crashed';
    }
  }

  return { health, cpuDisplay, memDisplay };
}

/**
 * Cache + in-flight dedupe wrapper. Concurrent topology polls for the
 * same `container_id` resolve to a single Docker round-trip; repeat
 * polls within `TOPOLOGY_NODE_CACHE_TTL_MS` reuse the cached value.
 *
 * Nodes without a `container_id` (compose parent rows that never spun
 * up) skip the cache entirely — there's nothing to fetch and nothing
 * to dedupe. The result is computed inline so the response shape stays
 * uniform with the cached path.
 */
async function getTopologyNodeRuntime(
  ctx: Pick<AppContext, 'docker'>,
  node: TopologyNode,
): Promise<TopologyNodeRuntime> {
  const containerId = node.container_id;
  if (!containerId) {
    return fetchTopologyNodeRuntime(ctx, node);
  }

  const cached = topologyNodeCache.get(containerId);
  if (cached && Date.now() - cached.ts < TOPOLOGY_NODE_CACHE_TTL_MS) {
    return cached.value;
  }

  const inflight = topologyNodeInFlight.get(containerId);
  if (inflight) {
    return inflight;
  }

  const promise = fetchTopologyNodeRuntime(ctx, node).finally(() => {
    topologyNodeInFlight.delete(containerId);
  });
  topologyNodeInFlight.set(containerId, promise);
  const value = await promise;
  topologyNodeCache.set(containerId, { ts: Date.now(), value });
  return value;
}

function mapEnvironment(projectName: string, environment: EnvironmentRow) {
  const ips = getAllIps();
  return {
    ...environment,
    url: `http://${getEnvironmentProjectHostname(projectName, environment.type)}`,
    urls: ips.map((ip) => ({
      url: `http://${getEnvironmentProjectHostname(projectName, environment.type, ip.address)}`,
      type: ip.type,
      ip: ip.address,
    })),
    created_at: normalizeTimestamp(environment.created_at),
    updated_at: normalizeTimestamp(environment.updated_at),
  };
}

function parseImageCmd(imageCmd: string | null): string[] | null {
  if (!imageCmd) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(imageCmd);
    return Array.isArray(parsed) && parsed.every((entry: unknown) => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

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

function mapProjectForApi(project: ProjectRow) {
  return {
    ...project,
    port: project.assigned_port ?? null,
    url: project.assigned_port ? getProjectUrl(project.name) : null,
    urls: project.assigned_port ? getProjectUrls(project.name) : [],
    publicUrl: project.public_url ?? null,
    repoUrl: project.repo_url,
    source: project.source,
    imageUrl: project.image_url ?? undefined,
    imageCmd: parseImageCmd(project.image_cmd),
    containerPort: project.container_port ?? null,
    created_at: normalizeTimestamp(project.created_at),
    updated_at: normalizeTimestamp(project.updated_at),
  };
}

function normalizeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const sqliteLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalizedInput = sqliteLike.test(trimmed) ? trimmed.replace(' ', 'T') + 'Z' : trimmed;
  const parsed = new Date(normalizedInput);

  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString();
}

function extractFailureSummary(buildLog: string | null): string | null {
  if (!buildLog) return null;

  const lines = buildLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = lines.find((line) => /error|failed|exception/i.test(line));
  return errorLine ?? lines.at(-1) ?? null;
}

function extractImageTagFromBuildLog(buildLog: string | null): string | null {
  if (!buildLog) return null;

  const buildMatch = buildLog.match(/\[build\]\s+([^\s]+)\s+\(\d+ms\)/);
  if (buildMatch?.[1]) {
    return buildMatch[1];
  }

  const rollbackMatch = buildLog.match(/\[rollback\]\s+[^\s]+\s+→\s+([^\s]+)/);
  if (rollbackMatch?.[1]) {
    return rollbackMatch[1];
  }

  const monorepoMatch = buildLog.match(/\[monorepo\].*→\s+([^\s]+)/);
  if (monorepoMatch?.[1]) {
    return monorepoMatch[1];
  }

  return null;
}

export function createProjectRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  // One-time cache invalidation hook — when a deploy lands (success or
  // failure) the topology likely changed, so drop ALL cached node
  // runtimes for the affected project. Topology nodes for unrelated
  // projects keep their cache (keyed on container_id which is globally
  // unique).
  //
  // Module-level guard prevents duplicate subscriptions when
  // createProjectRoutes is invoked multiple times (e.g. by test
  // harnesses re-mounting the routes).
  registerTopologyCacheInvalidation(ctx);

  api.post('/projects', async (c) => {
    const body = await c.req
      .json<{ repo_url?: string; branch?: string; name?: string }>()
      .catch(() => ({ repo_url: undefined, branch: undefined, name: undefined }));

    if (!body.repo_url) {
      return c.json({ error: 'MISSING_FIELD', message: 'repo_url is required' }, 400);
    }

    const projectName =
      (body.name && body.name.trim()) ||
      body.repo_url
        .split('/')
        .pop()
        ?.replace(/\.git$/, '');
    if (!projectName) {
      return c.json(
        { error: 'INVALID_PROJECT_NAME', message: 'Could not determine project name' },
        400,
      );
    }

    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (!PROJECT_NAME_REGEX.test(projectName)) {
      return c.json(
        {
          error: 'INVALID_PROJECT_NAME',
          message:
            'Project name must start with a lowercase letter or number, and contain only lowercase letters, numbers, and hyphens',
        },
        400,
      );
    }

    const existing = ctx.db.getProjectByName(projectName);
    if (existing) {
      return c.json(
        {
          error: 'PROJECT_ALREADY_EXISTS',
          message: `Project "${projectName}" already exists`,
          projectId: existing.id,
        },
        409,
      );
    }

    const created = ctx.db.createProject({
      id: crypto.randomUUID(),
      name: projectName,
      repoUrl: body.repo_url,
      branch: body.branch,
    });

    return c.json({
      project: {
        id: created.id,
        name: created.name,
        status: created.status,
      },
    });
  });

  api.get('/projects/:id/stats', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    if (project.container_id && project.status === 'running') {
      try {
        const stats = (await ctx.docker.getContainerStats(project.container_id)) as {
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
          status: project.status,
        });
      } catch (err) {
        log.debug({ err, projectId: project.id }, 'Container stats fetch failed');
        return c.json({
          cpu: 0,
          memory: 0,
          memoryLimit: 0,
          status: project.status,
        });
      }
    }

    return c.json({
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      status: project.status,
    });
  });

  api.get('/projects', (c) => {
    const status = c.req.query('status') as
      | 'running'
      | 'stopped'
      | 'building'
      | 'error'
      | undefined;
    const includeArchived = c.req.query('include_archived') === 'true';
    // Batch fetch projects + environments + child counts in O(3) queries
    // instead of the previous O(1 + 3N) per-project N+1 (was getEnvironments,
    // isParentProject, and getChildProjects per row).
    const projectsWithMeta = ctx.db.listProjectsWithMetadata(status, { includeArchived });
    const ips = getAllIps();

    return c.json({
      count: projectsWithMeta.length,
      projects: projectsWithMeta.map(({ project: p, environments, childCount }) => {
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          visibility: p.visibility,
          source: p.source,
          repoUrl: p.repo_url,
          branch: p.branch,
          port: p.assigned_port,
          url: p.assigned_port ? getProjectUrl(p.name) : null,
          urls: p.assigned_port
            ? ips.map((ip) => ({
                url: `http://${p.name}.${ip.address}.sslip.io`,
                type: ip.type,
                ip: ip.address,
              }))
            : [],
          publicUrl: p.public_url,
          ...(p.image_url ? { imageUrl: p.image_url } : {}),
          createdAt: normalizeTimestamp(p.created_at),
          updatedAt: normalizeTimestamp(p.updated_at),
          parentProjectId: p.parent_project_id,
          isCompose: childCount > 0,
          serviceCount: childCount,
          environments: environments.map((env) => mapEnvironment(p.name, env)),
        };
      }),
    });
  });

  api.get('/projects/:id', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const envVars = ctx.env.getAll(project.id);
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const deployLogs = ctx.db.getDeployLogs(project.id, 5);

    return c.json({
      ...mapProjectForApi(project),
      environments: environments.map((env) => mapEnvironment(project.name, env)),
      envVars,
      recentDeploys: deployLogs.map((log) => ({
        ...log,
        commitMessage: log.commit_message ?? null,
      })),
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
    const project = getProjectOrThrow(c, ctx);

    try {
      const childProjects = ctx.db.getChildProjects(project.id);
      const nodes = childProjects.length > 0 ? childProjects : [project];

      const nodeIds = new Set(nodes.map((n) => n.id));

      // Build dependsOn map: for each node, find its project_dependencies
      // whose target_service_id is another node in this topology.
      const dependsOnMap = new Map<string, string[]>();
      for (const node of nodes) {
        const deps = ctx.db.findDependenciesByProject(node.id);
        const siblingDeps = deps
          .map((d) => d.target_service_id)
          .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
        dependsOnMap.set(node.id, siblingDeps);
      }

      // Determine kind: 'Database' for known db service types, else 'Application'
      function resolveKind(name: string): 'Application' | 'Database' {
        const lower = name.toLowerCase();
        if (/postgres|mysql|mariadb|mongo|redis|sqlite|clickhouse|minio/.test(lower)) {
          return 'Database';
        }
        return 'Application';
      }

      // Inspect health for all nodes in parallel — but funnel through
      // a per-container 15s TTL cache + in-flight dedupe so rapid
      // repeat polls (UI re-renders, multiple tabs) collapse to a
      // single Docker call instead of N×services per poll.
      const serviceNodes = await Promise.all(
        nodes.map(async (node) => {
          // Derive port: compose child uses container_port or assigned_port
          const port = node.assigned_port ?? null;
          const url = port ? getProjectUrl(node.name) : null;
          const image = node.image_url ?? node.image_tag ?? `${node.name}:latest`;
          const kind = resolveKind(node.name);

          const runtime = await getTopologyNodeRuntime(ctx, node);

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

  api.patch('/projects/:id', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    const body = await c.req
      .json<{
        imageUrl?: unknown;
        imageCmd?: unknown;
        containerPort?: unknown;
        image_url?: unknown;
        image_cmd?: unknown;
        container_port?: unknown;
      }>()
      .catch(
        (): {
          imageUrl?: unknown;
          imageCmd?: unknown;
          containerPort?: unknown;
          image_url?: unknown;
          image_cmd?: unknown;
          container_port?: unknown;
        } => ({}),
      );

    const imageUrlRaw = body.imageUrl ?? body.image_url;
    const imageCmdRaw = body.imageCmd ?? body.image_cmd;
    const containerPortRaw = body.containerPort ?? body.container_port;

    const imageUrl =
      imageUrlRaw === undefined || imageUrlRaw === null
        ? undefined
        : typeof imageUrlRaw === 'string'
          ? imageUrlRaw
          : undefined;

    const imageCmd =
      imageCmdRaw === undefined || imageCmdRaw === null
        ? undefined
        : Array.isArray(imageCmdRaw) && imageCmdRaw.every((entry) => typeof entry === 'string')
          ? imageCmdRaw
          : typeof imageCmdRaw === 'string'
            ? imageCmdRaw
                .split(' ')
                .map((part) => part.trim())
                .filter((part) => part.length > 0)
            : undefined;

    const containerPort =
      containerPortRaw === undefined || containerPortRaw === null
        ? undefined
        : typeof containerPortRaw === 'number' && Number.isInteger(containerPortRaw)
          ? containerPortRaw
          : typeof containerPortRaw === 'string'
            ? Number.parseInt(containerPortRaw, 10)
            : undefined;

    if (containerPort !== undefined && !Number.isFinite(containerPort)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be a valid integer' },
        400,
      );
    }

    if (containerPort !== undefined && (containerPort < 1 || containerPort > 65535)) {
      return c.json(
        { error: 'INVALID_FIELD', message: 'containerPort must be between 1 and 65535' },
        400,
      );
    }

    ctx.db.updateProject(project.id, {
      imageUrl,
      imageCmd,
      containerPort,
    });

    const updatedProject = ctx.db.getProject(project.id);
    if (!updatedProject) {
      return c.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
    }

    return c.json(mapProjectForApi(updatedProject));
  });

  api.post('/projects/:id/environments', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment creation is disabled' }, 410);
  });

  api.get('/projects/:id/environments', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const environments = ctx.db.getEnvironmentsByProject(project.id);
    return c.json({ environments: environments.map((env) => mapEnvironment(project.name, env)) });
  });

  api.get('/projects/:id/environments/:envId', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const environment = getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    return c.json({ environment: mapEnvironment(project.name, environment) });
  });

  api.delete('/projects/:id/environments/:envId', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment deletion is disabled' }, 410);
  });

  api.get('/projects/:id/environments/:envId/env', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const environment = getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const envVars = ctx.env.getAllWithInheritance(project.id, environment.id);
    const inheritance = ctx.env.getInheritanceInfo(project.id, environment.id);

    return c.json({
      environment: mapEnvironment(project.name, environment),
      envVars,
      inheritance,
    });
  });

  api.post('/projects/:id/environments/:envId/env', async (c) => {
    const project = getProjectOrThrow(c, ctx);
    const environment = getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = ctx.env.setBulk(project.id, body.variables, environment.id);
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      environment: environment.type,
      keys: Object.keys(body.variables),
      needsRedeploy: changed && environment.status === 'running',
    });
  });

  // --- Connected Services ---

  api.get('/projects/:id/services', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const connections = ctx.db.listServiceConnectionsByProject(project.id);

    if (connections.length > 0) {
      const services = connections
        .map((connection) => ctx.db.getService(connection.service_id))
        .filter((service) => service !== undefined);

      return c.json(
        services.map((service) => ({
          id: service.id,
          name: service.name,
          type: service.type,
          status: service.status,
          port: service.port,
          containerName: service.container_name,
        })),
      );
    }

    const services = ctx.serviceManager.getProjectServices(project.id);
    return c.json(
      services.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        port: s.port,
        containerName: s.container_name,
      })),
    );
  });

  api.post('/projects/:id/services/:serviceId', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const serviceId = c.req.param('serviceId');

    const service = ctx.db.getService(serviceId);
    if (!service) {
      return c.json({ error: 'SERVICE_NOT_FOUND', message: 'Service not found' }, 404);
    }

    const existing = ctx.db.getServiceConnectionByProjectAndService(project.id, serviceId);
    if (existing) {
      return c.json({ error: 'ALREADY_CONNECTED', message: 'Service already connected' }, 409);
    }

    const connection = ctx.db.createServiceConnection({
      projectId: project.id,
      serviceId,
    });

    const credentials = parseServiceCredentials(service.credentials);
    const injectedKeys = autoInjectServiceEnv({
      db: ctx.db,
      env: ctx.env,
      projectId: project.id,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: service.type,
      containerName: service.container_name,
      credentials,
    });
    ctx.db.updateServiceConnection(connection.id, {
      autoInjectedEnvKeys: JSON.stringify(injectedKeys),
    });

    // Auto-sync dependency
    try {
      ctx.db.createProjectDependency({
        source_project_id: project.id,
        target_service_id: serviceId,
        dependency_type:
          service.type === 'postgres' || service.type === 'mysql'
            ? 'database'
            : service.type === 'redis'
              ? 'cache'
              : 'custom',
        source: 'auto',
      });
    } catch {
      // dependency sync is best-effort, don't fail the connection creation
    }

    return c.json(
      {
        id: connection.id,
        service: {
          id: service.id,
          name: service.name,
          type: service.type,
          status: service.status,
          port: service.port,
          containerName: service.container_name,
        },
        createdAt: connection.created_at,
        autoInjectedEnvKeys: injectedKeys,
      },
      201,
    );
  });

  api.delete('/projects/:id/services/:serviceId', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const serviceId = c.req.param('serviceId');

    const existing = ctx.db.getServiceConnectionByProjectAndService(project.id, serviceId);
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
    cleanupAutoInjectedEnv({
      db: ctx.db,
      env: ctx.env,
      projectId: project.id,
      autoInjectedEnvKeys,
    });

    ctx.db.deleteServiceConnectionByProjectAndService(project.id, serviceId);

    // Auto-remove dependency
    try {
      const deps = ctx.db.findDependenciesByProject(project.id);
      const matchingDep = deps.find(
        (d) => d.target_service_id === serviceId && d.source === 'auto',
      );
      if (matchingDep) ctx.db.deleteProjectDependency(matchingDep.id);
    } catch {
      // dependency cleanup is best-effort
    }

    return c.json({ message: 'Service disconnected', serviceId });
  });

  // --- Deployment History ---

  api.get('/projects/:id/deployments', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const environmentId = c.req.query('environmentId');
    const logs = ctx.db.getDeployLogs(project.id, limit, environmentId);

    return c.json({
      count: logs.length,
      deployments: logs.map((log) => ({
        id: log.id,
        status: log.status,
        trigger: log.trigger,
        triggerDetail: log.trigger_detail,
        commitSha: log.commit_sha,
        commitMessage: log.commit_message ?? null,
        durationMs: log.duration_ms,
        createdAt: normalizeTimestamp(log.created_at),
        failureSummary: log.status === 'failed' ? extractFailureSummary(log.build_log) : null,
      })),
    });
  });

  api.get('/projects/:id/deployments/:deployId', (c) => {
    const deployId = c.req.param('deployId');
    const project = getProjectOrThrow(c, ctx);

    const log = ctx.db.getDeployLog(deployId);
    if (!log || log.project_id !== project.id) {
      return c.json({ error: 'NOT_FOUND', message: 'Deployment not found' }, 404);
    }

    return c.json({
      id: log.id,
      projectId: log.project_id,
      status: log.status,
      trigger: log.trigger,
      triggerDetail: log.trigger_detail,
      commitSha: log.commit_sha,
      commitMessage: log.commit_message ?? null,
      buildLog: log.build_log,
      runtimeLog: log.runtime_log ?? null,
      durationMs: log.duration_ms,
      createdAt: normalizeTimestamp(log.created_at),
    });
  });

  // v0.2.3: Start a stopped project
  api.post('/projects/:id/start', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectLifecycleMutable(project, 'start', ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    if (!project.container_id) {
      return c.json({ error: 'No container to start. Redeploy instead.' }, 400);
    }

    await ctx.pipeline.start(project.id);
    return c.json({ status: 'started', project: project.name });
  });

  api.post('/projects/:id/stop', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectLifecycleMutable(project, 'stop', ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    // Per-project lock (1.0 GA B2): `assertProjectLifecycleMutable` only
    // inspects the persisted status field, so an in-flight deploy is
    // invisible to it. Without the in-memory lock guard, clicking stop
    // mid-deploy races against the redeploy/rollback/blue-green flows and
    // can leave the container in an inconsistent state. Surface the
    // contention as the typed 409 the UI already understands.
    const lockSessionId = `stop-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      ctx.coordinator.suppressProject(project.id, 60_000);
      await ctx.pipeline.stop(project.id);
      return c.json({ status: 'stopped', project: project.name });
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  api.post('/projects/:id/redeploy', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectMutable(project, ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    const strategy = (c.req.query('strategy') ?? 'force') as 'blue-green' | 'force';

    // If caller provides env_vars, merge them into existing vars before redeploying
    const body = await c.req
      .json<{
        env_vars?: Record<string, string>;
        no_cache?: boolean;
        health_check_path?: string;
      }>()
      .catch(() => ({ env_vars: undefined, no_cache: undefined, health_check_path: undefined }));
    if (body.env_vars && typeof body.env_vars === 'object') {
      for (const [key, value] of Object.entries(body.env_vars)) {
        if (value.trim()) {
          ctx.env.set(project.id, key, value.trim());
        }
      }
    }

    if (project.source === 'git' && !project.repo_url) {
      return c.json({ success: false, error: 'Missing repo URL for git redeploy' }, 400);
    }

    // Per-project lock instead of a global deploy queue (1.0 GA): two
    // different projects can deploy concurrently. Same-project double-click
    // is still rejected with a 409 because the in-memory lock + pipeline
    // boundary's `withDeployLock` both refuse a second concurrent attempt.
    const lockSessionId = `redeploy-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      ctx.coordinator.suppressProject(project.id, 120_000);
      ctx.db.updateProject(project.id, { status: 'building' });
      const result = await ctx.pipeline.redeploy(project.id, {
        noCache: body.no_cache,
        strategy,
        healthCheckPath: body.health_check_path,
      });
      return c.json(result, result.success ? 200 : 500);
    } catch (err) {
      if (err instanceof DeployLockedError) {
        return c.json(err.toJSON(), 409);
      }
      // Race-window: project may have been archived / sent to recovering /
      // tripped its circuit breaker between the route-level
      // `assertProjectMutable` check and the pipeline boundary check.
      // Surface those as the typed 409 they are instead of a generic 500.
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      ctx.db.updateProject(project.id, { status: 'error' });
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  // v0.3: Rollback
  api.post('/projects/:id/rollback', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectMutable(project, ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    const environmentResolution = resolveEnvironmentByType(c, ctx, project);
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;

    const body = await c.req
      .json<{ deployment_id?: unknown }>()
      .catch(() => ({ deployment_id: undefined }));
    const deploymentId =
      typeof body.deployment_id === 'string' && body.deployment_id.trim().length > 0
        ? body.deployment_id.trim()
        : undefined;

    if (deploymentId) {
      const deployment = ctx.db.getDeployLog(deploymentId);
      if (!deployment || deployment.project_id !== project.id) {
        return c.json(
          {
            error: 'DEPLOYMENT_NOT_FOUND',
            message: `Deployment ${deploymentId} not found for project`,
          },
          404,
        );
      }

      const isRequestedEnvironmentMatch =
        deployment.environment_id === null ||
        (!!environmentRow && deployment.environment_id === environmentRow.id);

      if (!isRequestedEnvironmentMatch) {
        return c.json(
          {
            error: 'DEPLOYMENT_ENVIRONMENT_MISMATCH',
            message: 'Selected deployment does not belong to the requested environment',
          },
          400,
        );
      }

      const imageTag = extractImageTagFromBuildLog(deployment.build_log);
      if (!imageTag) {
        return c.json(
          {
            error: 'DEPLOYMENT_IMAGE_NOT_FOUND',
            message: 'Could not determine image tag from selected deployment',
          },
          400,
        );
      }

      ctx.db.updateProject(project.id, { previousImageTag: imageTag });
      if (environmentRow) {
        ctx.db.updateEnvironment(environmentRow.id, { previousImageTag: imageTag });
      }
    }

    // Per-project lock (1.0 GA B1): match /redeploy + /blue-green so two
    // concurrent rollback requests on the same project are rejected with a
    // typed 409 at the route layer instead of falling through to the DB-level
    // `withDeployLock` and surfacing as a deeper error.
    const lockSessionId = `rollback-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      const result = await ctx.pipeline.rollback(project.id);
      return c.json(result, result.success ? 200 : 500);
    } catch (err) {
      if (err instanceof DeployLockedError) {
        return c.json(err.toJSON(), 409);
      }
      // Race-window: pipeline boundary may reject after the route-level
      // assertProjectMutable passed.
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      throw err;
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  // v0.3: Blue-green deployment
  api.post('/projects/:id/blue-green', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectMutable(project, ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    const body = await c.req
      .json<{ health_check_path?: string }>()
      .catch((): { health_check_path?: string } => ({}));
    // Per-project lock (see comment on /projects/:id/redeploy above)
    const lockSessionId = `bluegreen-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      const result = await ctx.pipeline.redeploy(project.id, {
        strategy: 'blue-green',
        healthCheckPath: body.health_check_path,
      });
      return c.json(result, result.success ? 200 : 500);
    } catch (err) {
      if (err instanceof DeployLockedError) {
        return c.json(err.toJSON(), 409);
      }
      // Race-window: pipeline boundary may reject after the route-level
      // assertProjectMutable passed (project archived / recovering / circuit
      // tripped between the two checks). Surface as the typed 409 they are.
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      throw err;
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  // v0.2.3: Webhook settings API
  api.get('/projects/:id/webhooks', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const configs = ctx.db.getWebhookConfigs(project.id);
    return c.json({
      webhooks: configs.map((cfg) => ({
        id: cfg.id,
        source: cfg.source,
        secret: cfg.secret,
        branchFilter: cfg.branch_filter,
        enabled: cfg.enabled === 1,
        webhookUrl: `/api/webhooks/${project.id}/${cfg.source}`,
        createdAt: normalizeTimestamp(cfg.created_at),
      })),
    });
  });

  api.post('/projects/:id/webhooks', async (c) => {
    const project = getProjectOrThrow(c, ctx);
    const body = await c.req.json<{ source: string; branch_filter?: string; enabled?: boolean }>();
    if (!body.source || !['github', 'gitlab', 'bitbucket'].includes(body.source)) {
      return c.json({ error: 'Invalid source. Must be github, gitlab, or bitbucket.' }, 400);
    }
    const source = body.source as 'github' | 'gitlab' | 'bitbucket';
    const existing = ctx.db.getWebhookConfig(project.id, source);
    const secret = existing?.secret ?? `${project.id}.${crypto.randomUUID().replace(/-/g, '')}`;
    const configId = existing?.id ?? crypto.randomUUID();
    ctx.db.setWebhookConfig({
      id: configId,
      projectId: project.id,
      source,
      secret,
      branchFilter: body.branch_filter ?? 'main',
      enabled: body.enabled !== false,
    });
    const config = ctx.db.getWebhookConfig(project.id, source);
    if (!config) {
      return c.json({ error: 'Failed to configure webhook' }, 500);
    }
    return c.json({
      id: config.id,
      source: config.source,
      secret: config.secret,
      branchFilter: config.branch_filter,
      enabled: config.enabled === 1,
      webhookUrl: `/api/webhooks/${project.id}/${config.source}`,
    });
  });

  api.delete('/projects/:id/webhooks/:source', (c) => {
    const source = c.req.param('source');
    const project = getProjectOrThrow(c, ctx);
    if (!['github', 'gitlab', 'bitbucket'].includes(source)) {
      return c.json({ error: 'Invalid source' }, 400);
    }
    ctx.db.deleteWebhookConfig(project.id, source as 'github' | 'gitlab' | 'bitbucket');
    return c.json({ status: 'deleted' });
  });

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
    const project = getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ action: string }>().catch(() => ({ action: '' }));
    const { action } = body;

    switch (action) {
      case 'cleanup_stale': {
        // Remove old containers for this project (keep the current one)
        const managed = await ctx.docker.listManagedContainers();
        const stale = managed.filter(
          (c) =>
            c.name.startsWith(project.name) &&
            c.id !== project.container_id &&
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

  // --- Archive / Unarchive / Purge ---

  api.post('/projects/:id/archive', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectLifecycleMutable(project, 'archive', ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    // Per-project lock (1.0 GA B2): same rationale as /stop — block archive
    // when a deploy/rollback/blue-green is in flight.
    const lockSessionId = `archive-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      ctx.coordinator.suppressProject(project.id, 60_000);
      await ctx.pipeline.archive(project.id);
      const updated = ctx.db.getProject(project.id);
      return c.json({ project: updated });
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  api.post('/projects/:id/unarchive', async (c) => {
    const project = getProjectOrThrow(c, ctx);
    await ctx.pipeline.unarchive(project.id);
    const updated = ctx.db.getProject(project.id);
    return c.json({ project: updated });
  });

  api.delete('/projects/:id/purge', async (c) => {
    const confirm = c.req.query('confirm');
    if (confirm !== 'true') {
      return c.json(
        { error: 'Confirmation required. Add ?confirm=true to permanently delete.' },
        400,
      );
    }
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectLifecycleMutable(project, 'purge', ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    // Per-project lock (1.0 GA B2): block hard-delete if any deploy/rollback
    // is in flight. Permanently removing rows + containers mid-deploy is the
    // worst-case race — surface it as a typed 409.
    const lockSessionId = `purge-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      ctx.coordinator.suppressProject(project.id, 60_000);
      await ctx.pipeline.remove(project.id, ctx.cloudflare);
      return c.json({ success: true, message: 'Project permanently deleted' });
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  api.delete('/projects/:id', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    try {
      assertProjectLifecycleMutable(project, 'archive', ctx);
    } catch (err) {
      if (
        err instanceof ProjectArchivedError ||
        err instanceof ProjectRecoveringError ||
        err instanceof CircuitBreakerOpenError
      ) {
        return c.json(err.toJSON(), 409);
      }
      throw err;
    }

    // Per-project lock (1.0 GA B2): same rationale as POST /archive — DELETE
    // soft-archives, so block when a deploy is mid-flight.
    const lockSessionId = `delete-${project.id}-${Date.now().toString(36)}`;
    if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
      const lock = ctx.agentPool.getProjectLock(project.id);
      return c.json(new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(), 409);
    }
    try {
      ctx.coordinator.suppressProject(project.id, 60_000);
      await ctx.pipeline.archive(project.id);
      return c.json({ status: 'archived', project: project.name });
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  api.get('/projects/:id/logs', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    const follow = c.req.query('follow');

    if (follow && project.container_id) {
      const containerId = project.container_id;
      return stream(c, async (s) => {
        c.header('Content-Type', 'application/x-ndjson');

        try {
          const logStream = await ctx.docker.getLogStream(containerId, { tail: 50 });

          logStream.on('data', (chunk: Buffer) => {
            const headerSize = 8;
            const streamType = chunk[0] === 1 ? 'stdout' : 'stderr';
            const line = chunk.subarray(headerSize).toString('utf8').trim();

            if (line) {
              const logEntry = {
                line,
                stream: streamType,
                time: new Date().toISOString(),
              };
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
    const logs = await ctx.pipeline.getLogs(project.id, lines);

    return c.json({ project: project.name, logs });
  });

  api.get('/projects/:id/env', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const vars = ctx.env.getAll(project.id);
    return c.json({ project: project.name, envVars: vars });
  });

  api.get('/projects/:id/env-example', async (c) => {
    const project = getProjectOrThrow(c, ctx);
    if (!project.repo_url) {
      return c.json({ error: 'MISSING_REPO_URL', message: 'Project has no repository URL' }, 400);
    }

    const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
    const allowedEnvironments = new Set(['production', 'development']);
    if (!allowedEnvironments.has(requestedEnvironment)) {
      return c.json(
        {
          error: 'INVALID_ENVIRONMENT',
          message: 'environment must be one of: production, development',
        },
        400,
      );
    }

    const environmentResolution = resolveEnvironmentByType(c, ctx, project, {
      requireExistingEnvironmentWhenAnyExists: true,
    });
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({
        repoUrl: project.repo_url,
        branch: environmentRow?.branch ?? project.branch,
      });
      clonePath = cloneResult.path;
      const scanResult = scanForEnvUsage(clonePath);
      const existingVars = environmentRow
        ? ctx.env.getAllWithInheritance(project.id, environmentRow.id)
        : ctx.env.getAll(project.id);
      const envExample = generateEnvExample(scanResult, existingVars);
      return c.text(envExample);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'ENV_EXAMPLE_GENERATION_FAILED', message }, 500);
    } finally {
      if (clonePath) {
        await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  api.post('/projects/:id/env', async (c) => {
    const project = getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = ctx.env.setBulk(project.id, body.variables);
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      keys: Object.keys(body.variables),
      needsRedeploy: changed && project.status === 'running',
    });
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

      const normalized = answer as {
        questionIndex?: unknown;
        selectedLabels?: unknown;
        customText?: unknown;
      };

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
    const project = getProjectOrThrow(c, ctx);

    if (!project.assigned_port) {
      return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
    }

    try {
      const url = await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
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

  api.post('/projects/:id/unexpose', (c) => {
    const project = getProjectOrThrow(c, ctx);

    ctx.pipeline.closeTunnel(project.id);
    return c.json({ status: 'unexposed', project: project.name });
  });

  api.post('/projects/:id/share', async (c) => {
    const project = getProjectOrThrow(c, ctx);

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

    if (project.visibility !== 'quick-share' && project.visibility !== 'shared') {
      if (!project.assigned_port) {
        return c.json({ error: 'NOT_RUNNING', message: 'Project is not running' }, 400);
      }
      try {
        await ctx.pipeline.exposeTunnel(project.id, project.assigned_port);
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
      const assignedPort = project.assigned_port;
      if (assignedPort === null) {
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

    ctx.db.updateProject(project.id, {
      visibility: 'shared',
      accessCode: encrypted,
      accessCodeIv: iv,
    });

    const updatedProject = ctx.db.getProject(project.id);
    return c.json({
      status: 'shared',
      project: project.name,
      publicUrl: updatedProject?.public_url,
    });
  });

  api.delete('/projects/:id/share', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const tunnel = ctx.pipeline.getTunnel(project.id);
    if (tunnel) {
      tunnel.disableSharedMode(project.name);
    }

    ctx.db.updateProject(project.id, {
      visibility: 'quick-share',
      accessCode: null,
      accessCodeIv: null,
    });

    return c.json({ status: 'unshared', project: project.name });
  });

  api.get('/projects/:id/previews', (c) => {
    const project = getProjectOrThrow(c, ctx);

    const previews = ctx.db.getPreviewProjects(project.id);
    return c.json({
      previews: previews.map((preview) => ({
        id: preview.id,
        name: preview.name,
        status: preview.status,
        prNumber: preview.pr_number,
        url: getProjectUrl(preview.name),
        publicUrl: preview.public_url,
        createdAt: normalizeTimestamp(preview.created_at),
        updatedAt: normalizeTimestamp(preview.updated_at),
      })),
    });
  });

  api.delete('/projects/:id/previews/:previewId', async (c) => {
    const previewId = c.req.param('previewId');
    const project = getProjectOrThrow(c, ctx);

    const preview = ctx.db.getProject(previewId);
    if (!preview || preview.parent_project_id !== project.id) {
      return c.json({ error: 'PREVIEW_NOT_FOUND', message: 'Preview not found' }, 404);
    }

    await ctx.pipeline.remove(previewId, ctx.cloudflare);
    return c.json({ status: 'removed', preview: preview.name });
  });

  return api;
}
