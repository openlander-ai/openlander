import { Hono } from 'hono';
import type { Context } from 'hono';
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
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';

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
        // PR 4 canonical-first: prefer the deployable service's container_id
        // (post-0012 source of truth) over the legacy projects column.
        const deployable =
          typeof ctx.db.getDeployableForProject === 'function'
            ? ctx.db.getDeployableForProject(projectId)
            : undefined;
        invalidateTopologyNodeCache(deployable?.container_id ?? project.container_id);
      }
      // getChildProjects is a Database method but some narrow test
      // fixtures stub `db` with only the methods they exercise — guard
      // so the optional cache lookup never crashes the subscription.
      if (typeof ctx.db.getChildProjects === 'function') {
        const children = ctx.db.getChildProjects(projectId);
        for (const child of children) {
          const childDeployable =
            typeof ctx.db.getDeployableForProject === 'function'
              ? ctx.db.getDeployableForProject(child.id)
              : undefined;
          invalidateTopologyNodeCache(childDeployable?.container_id ?? child.container_id);
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
  // Compose deploys never emit deploy:success / deploy:failed — they emit
  // compose:up / compose:failed instead. Without these subscriptions the
  // topology cache stayed stale for the full 15s TTL after a compose
  // rollout or failure (Codex MEDIUM-1).
  ctx.eventBus.on('compose:up', (payload) => {
    invalidateProjectContainers(payload.projectId);
  });
  ctx.eventBus.on('compose:failed', (payload) => {
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

/**
 * Deployable fields that can be read from the canonical services row.
 * All fields are optional — callers pass `undefined` when no deployable row
 * exists yet (e.g. during project creation).
 */
type DeployableForApi = {
  kind?: string | null;
  status?: string | null;
  assigned_port?: number | null;
  container_id?: string | null;
  container_port?: number | null;
  image_tag?: string | null;
  previous_image_tag?: string | null;
  public_url?: string | null;
  image_url?: string | null;
  source?: string | null;
  build_method?: string | null;
  dockerfile_path?: string | null;
  // PR 4.5: residual deployable fields read by mapProjectForApi.
  access_code?: string | null;
  access_code_iv?: string | null;
  pending_fix?: string | null;
  recovering_started_at?: string | null;
  docker_target?: string | null;
  build_context?: string | null;
  image_cmd?: string | null;
  project_type?: 'web' | 'worker' | null;
  is_preview?: number | null;
  pr_number?: number | null;
  health_check_strategy?: 'http' | 'tcp' | 'exec' | 'none' | null;
  health_check_path?: string | null;
};

/**
 * Map a project row to the wire shape used by /api/projects/:id and friends.
 *
 * PR 4 (Fix 1): Every deployable runtime field reads canonical-first from the
 * `services` row (`<projectId>__svc`) with `??` fallback to the legacy
 * `projects` columns through migration 0012.  NO `...project` spread — all
 * wire keys are emitted explicitly so that when 0012 drops legacy columns the
 * wire format is unchanged.  Wire keys are preserved byte-identical.
 */
function mapProjectForApi(project: ProjectRow, deployable?: DeployableForApi) {
  // Deployable runtime fields — canonical-first ?? legacy fallback.
  const port = deployable?.assigned_port ?? project.assigned_port ?? null;
  const imageUrl = deployable?.image_url ?? project.image_url ?? undefined;
  const status = deployable?.status ?? project.status;
  const containerId = deployable?.container_id ?? project.container_id ?? null;
  const containerPort = deployable?.container_port ?? project.container_port ?? null;
  const imageTag = deployable?.image_tag ?? project.image_tag ?? null;
  const previousImageTag = deployable?.previous_image_tag ?? project.previous_image_tag ?? null;
  const publicUrl = deployable?.public_url ?? project.public_url ?? null;
  const source = deployable?.source ?? project.source;
  const buildMethod = deployable?.build_method ?? project.build_method ?? null;
  const dockerfilePath = deployable?.dockerfile_path ?? project.dockerfile_path;
  // PR 4.5: residual deployable fields canonicalized in mapProjectForApi.
  const accessCode = deployable?.access_code ?? project.access_code;
  const accessCodeIv = deployable?.access_code_iv ?? project.access_code_iv;
  const pendingFix = deployable?.pending_fix ?? project.pending_fix;
  const recoveringStartedAt = deployable?.recovering_started_at ?? project.recovering_started_at;
  const dockerTarget = deployable?.docker_target ?? project.docker_target;
  const buildContext = deployable?.build_context ?? project.build_context;
  const imageCmdRaw = deployable?.image_cmd ?? project.image_cmd;
  const projectType = deployable?.project_type ?? project.project_type;
  const isPreview = deployable?.is_preview ?? project.is_preview;
  const prNumber = deployable?.pr_number ?? project.pr_number;
  const healthCheckStrategy = deployable?.health_check_strategy ?? project.health_check_strategy;
  const healthCheckPath = deployable?.health_check_path ?? project.health_check_path;

  return {
    // --- Identity / group fields (live on `projects` permanently) ---
    id: project.id,
    name: project.name,
    repo_url: project.repo_url,
    branch: project.branch,
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    parent_project_id: project.parent_project_id,
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    visibility: project.visibility,
    server_id: project.server_id,
    project_type: projectType,
    is_preview: isPreview,
    pr_number: prNumber,
    health_check_strategy: healthCheckStrategy,
    health_check_path: healthCheckPath,
    deploy_lock_session: project.deploy_lock_session,
    deploy_lock_at: project.deploy_lock_at,
    access_code: accessCode,
    access_code_iv: accessCodeIv,
    pending_fix: pendingFix,
    recovering_started_at: recoveringStartedAt,
    archived_at: project.archived_at,
    docker_target: dockerTarget,
    build_context: buildContext,
    // --- Deployable runtime fields — canonical-first ?? legacy fallback ---
    status,
    container_id: containerId,
    image_tag: imageTag,
    previous_image_tag: previousImageTag,
    build_method: buildMethod,
    dockerfile_path: dockerfilePath,
    // --- Transformed/computed wire keys (camelCase for frontend) ---
    port,
    url: port ? getProjectUrl(project.name) : null,
    urls: port ? getProjectUrls(project.name) : [],
    publicUrl,
    repoUrl: project.repo_url,
    source,
    imageUrl,
    imageCmd: parseImageCmd(imageCmdRaw ?? null),
    containerPort,
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

  // ---------------------------------------------------------------------------
  // Deprecated-endpoint middleware (rc.1)
  // Adds X-Deprecated-Endpoint to all legacy /projects/:id/* responses so API
  // consumers can discover and migrate to the canonical vocabulary before 2.0.
  // Must be registered BEFORE route handlers so Hono applies it on the way out.
  // ---------------------------------------------------------------------------

  const DEPRECATED_HEADER_VALUE =
    'use METHOD /api/projects/:p/services/:s/<verb> since=1.0-rc.1 removed_in=2.0';

  // Returns true for canonical /projects/:p/services/:s/... paths — these must NOT get the header.
  const isCanonicalProjectServicePath = (path: string): boolean =>
    /\/projects\/[^/]+\/services\/[^/]+/.test(path);

  // Hono middleware: intercept responses for legacy /projects/:id/* routes.
  // Skip canonical /projects/:p/services/:s/... paths (Hono's /:id/* also matches those).
  api.use('/projects/:id/*', async (c, next) => {
    await next();
    if (!isCanonicalProjectServicePath(c.req.path)) {
      c.res.headers.set('X-Deprecated-Endpoint', DEPRECATED_HEADER_VALUE);
    }
  });

  // Hono's /projects/:id/* does NOT match /projects/:id (exact, no sub-path).
  // Add a second middleware to cover the exact route.
  api.use('/projects/:id', async (c, next) => {
    await next();
    c.res.headers.set('X-Deprecated-Endpoint', DEPRECATED_HEADER_VALUE);
  });

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

    // PR 4 canonical-first: prefer the deployable services row for
    // status + container_id; fall back to legacy projects columns through
    // migration 0012.
    const deployable = ctx.db.getDeployableForProject(project.id);
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

    // CCG perf #3 (Codex 2026-04-30): the per-row pre-fetch loop here was
    // an N+1 — listProjectsWithMetadata → listProjects already batch-hydrates
    // every row from its `<id>__svc` service (project.repo.ts:251), so
    // p.status / p.assigned_port / p.image_url / p.source / p.public_url
    // are already canonical-first. With include_archived=true on dogfood
    // mini that loop was ~131 round-trips for nothing.
    return c.json({
      count: projectsWithMeta.length,
      projects: projectsWithMeta.map(({ project: p, environments, childCount, isCompose }) => {
        // Wire shape unchanged — the same canonical fields, just read off p
        // directly instead of through getDeployableForProject(p.id). The
        // `p` object is the listProjects-hydrated row (project.repo.ts:251):
        // status / assigned_port / image_url come from the __svc service,
        // not the dropped projects-table columns. The lint rule's name-based
        // check would flag the read; the data is already canonical.
        /* eslint-disable openlander-internal/no-dropped-columns */
        const projectStatus = p.status;
        const port = p.assigned_port;
        const imageUrl = p.image_url;
        const projectSource = p.source;
        const publicUrl = p.public_url ?? null;
        /* eslint-enable openlander-internal/no-dropped-columns */
        return {
          id: p.id,
          name: p.name,
          status: projectStatus,
          // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          visibility: p.visibility,
          source: projectSource,
          repoUrl: p.repo_url,
          branch: p.branch,
          port,
          url: port ? getProjectUrl(p.name) : null,
          urls: port
            ? ips.map((ip) => ({
                url: `http://${p.name}.${ip.address}.sslip.io`,
                type: ip.type,
                ip: ip.address,
              }))
            : [],
          publicUrl,
          ...(imageUrl ? { imageUrl } : {}),
          createdAt: normalizeTimestamp(p.created_at),
          updatedAt: normalizeTimestamp(p.updated_at),
          // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          parentProjectId: p.parent_project_id,
          isCompose,
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
    // PR 4 canonical-first: fetch the deployable service row once and
    // pass into mapProjectForApi so wire emission reads canonical fields
    // (kind/image_url/assigned_port) with `??` fallback.
    const deployable = ctx.db.getDeployableForProject(project.id);

    return c.json({
      ...mapProjectForApi(project, deployable),
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
      // Post-grouping: a project is a group with N deployable services.
      // List services as topology nodes. Falls back to legacy compose-child
      // projects for backward compatibility (pre-grouping data).
      // CCG perf #4 (Codex 2026-04-30): only run the legacy getChildProjects
      // path when the group has no services. The previous unconditional call
      // ran a query + N getProject() round-trips for every grouped project,
      // even though the result was discarded by useServices=true.
      const groupServices = ctx.db.getDeployablesByGroup(project.id);
      const useServices = groupServices.length > 0;
      const childProjects = useServices ? [] : ctx.db.getChildProjects(project.id);

      const nodeIds = new Set(
        useServices
          ? groupServices.map((s) => s.id)
          : (childProjects.length > 0 ? childProjects : [project]).map((n) => n.id),
      );

      // Build dependsOn map: for each node, find its project_dependencies
      // whose target_service_id is another node in this topology.
      const dependsOnMap = new Map<string, string[]>();
      const dependencyIdSource = useServices
        ? groupServices.map((s) => s.id.replace(/__svc$/, ''))
        : (childProjects.length > 0 ? childProjects : [project]).map((n) => n.id);
      for (const lookupId of dependencyIdSource) {
        const deps = ctx.db.findDependenciesByProject(lookupId);
        const siblingDeps = deps
          .map((d) => d.target_service_id)
          .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
        const nodeId = useServices ? `${lookupId}__svc` : lookupId;
        dependsOnMap.set(nodeId, siblingDeps);
      }

      // Determine kind: 'Database' for known db service types, else 'Application'
      function resolveKind(kindOrName: string): 'Application' | 'Database' {
        const lower = kindOrName.toLowerCase();
        if (/postgres|mysql|mariadb|mongo|redis|sqlite|clickhouse|minio/.test(lower)) {
          return 'Database';
        }
        return 'Application';
      }

      // Inspect health for all nodes in parallel — funneled through
      // per-container 15s TTL cache + in-flight dedupe.
      const serviceNodes = useServices
        ? await Promise.all(
            groupServices.map(async (svc) => {
              const port = svc.assigned_port ?? null;
              // Display name strips __svc suffix and group-name prefix.
              const displayName = svc.name.replace(/__svc$/, '');
              const url = port ? getProjectUrl(displayName) : null;
              const image = svc.image_url ?? svc.image_tag ?? `${displayName}:latest`;
              const kind = resolveKind(svc.kind);
              const runtime = await getTopologyNodeRuntime(ctx, {
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
              };
            }),
          )
        : await Promise.all(
            (childProjects.length > 0 ? childProjects : [project]).map(async (node) => {
              const deployable = ctx.db.getDeployableForProject(node.id);
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
      imageCmd: imageCmd ? JSON.stringify(imageCmd) : null,
      containerPort,
    });

    const updatedProject = ctx.db.getProject(project.id);
    if (!updatedProject) {
      return c.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
    }

    // PR 4 canonical-first: re-read deployable after mutation.
    const updatedDeployable = ctx.db.getDeployableForProject(updatedProject.id);
    return c.json(mapProjectForApi(updatedProject, updatedDeployable));
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

  // rc.2 §6.6: canonical body — returns deployables scoped to the group via
  // `db.getServices({ project_id, kindNotIn: MANAGED_SERVICE_KINDS })`.
  // Legacy connection-mapped managed services were moved under
  // /projects/:p/managed-services (also wired below).
  api.get('/projects/:id/services', (c) => {
    const project = getProjectOrThrow(c, ctx);
    const deployables = ctx.db.getServices({
      project_id: project.id,
      kindNotIn: MANAGED_SERVICE_KINDS,
    });
    return c.json({
      count: deployables.length,
      services: deployables.map((svc) => ({
        id: svc.id,
        // v5.1: strip the `__svc` suffix from the display name. The suffix is
        // an internal convention from the post-0009 service-id scheme and
        // should never reach the user (the topology endpoint already does
        // this — same treatment here for the deployables list).
        name: svc.name.replace(/__svc$/, ''),
        kind: svc.kind,
        status: svc.status,
        assigned_port: svc.assigned_port,
        container_id: svc.container_id,
        container_name: svc.container_name,
        image_tag: svc.image_tag,
        created_at: normalizeTimestamp(svc.created_at),
        updated_at: normalizeTimestamp(svc.updated_at),
      })),
    });
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
    // Wire contract: emit legacy vocabulary (postgresql/mongodb) for back-compat.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const serviceKind = service.type ?? kindToLegacyType(service.kind);
    const injectedKeys = autoInjectServiceEnv({
      db: ctx.db,
      env: ctx.env,
      projectId: project.id,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: serviceKind,
      containerName: service.container_name ?? '',
      credentials,
    });
    ctx.db.updateServiceConnection(connection.id, {
      autoInjectedEnvKeys: JSON.stringify(injectedKeys),
    });

    // Auto-sync dependency
    try {
      ctx.db.createProjectDependency({
        source_service_id: `${project.id}__svc`,
        target_service_id: serviceId,
        dependency_type:
          serviceKind === 'postgres' || serviceKind === 'mysql'
            ? 'database'
            : serviceKind === 'redis'
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

    // PR 4 canonical-first: read container_id from the deployable services
    // row when available; fall back to the legacy projects column.
    const deployable = ctx.db.getDeployableForProject(project.id);
    const containerId = deployable?.container_id ?? project.container_id;
    if (!containerId) {
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

    // PR 4 canonical-first: source is on services post-0009 too. Read
    // canonical with legacy fallback.
    const deployable = ctx.db.getDeployableForProject(project.id);
    const projectSource = deployable?.source ?? project.source;
    if (projectSource === 'git' && !project.repo_url) {
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
        // Remove old containers for this project (keep the current one).
        // PR 4 canonical-first: prefer deployable services row's
        // container_id; fall back to legacy projects column through 0012.
        const deployable = ctx.db.getDeployableForProject(project.id);
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

    // PR 4 canonical-first: container_id from deployable services row.
    const deployable = ctx.db.getDeployableForProject(project.id);
    const followContainerId = deployable?.container_id ?? project.container_id;
    if (follow && followContainerId) {
      const containerId = followContainerId;
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
    // PR 4 canonical-first: status from deployable services row.
    const deployable = ctx.db.getDeployableForProject(project.id);
    const projectStatus = deployable?.status ?? project.status;
    return c.json({
      status: changed ? 'updated' : 'unchanged',
      project: project.name,
      keys: Object.keys(body.variables),
      needsRedeploy: changed && projectStatus === 'running',
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
    const project = getProjectOrThrow(c, ctx);

    // PR 4 canonical-first: assigned_port from deployable services row.
    const deployable = ctx.db.getDeployableForProject(project.id);
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

    // PR 4 canonical-first: assigned_port from deployable services row.
    const shareDeployable = ctx.db.getDeployableForProject(project.id);
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

    ctx.db.updateProject(project.id, {
      visibility: 'shared',
      accessCode: encrypted,
      accessCodeIv: iv,
    });

    const updatedProject = ctx.db.getProject(project.id);
    // PR 4 canonical-first: public_url from deployable services row.
    const updatedDeployable = updatedProject
      ? ctx.db.getDeployableForProject(updatedProject.id)
      : undefined;
    return c.json({
      status: 'shared',
      project: project.name,
      publicUrl: updatedDeployable?.public_url ?? updatedProject?.public_url,
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
      previews: previews.map((preview) => {
        // PR 4 canonical-first: status + public_url from each preview's
        // deployable services row when available; fall back to legacy
        // projects columns through migration 0012.
        const deployable = ctx.db.getDeployableForProject(preview.id);
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
    });
  });

  api.delete('/projects/:id/previews/:previewId', async (c) => {
    const previewId = c.req.param('previewId');
    const project = getProjectOrThrow(c, ctx);

    // PR 4 canonical-first (Codex CCG flagged): resolve preview's parent
    // via the services hierarchy first (parent_service_id stripped of
    // `__svc` suffix → parent project id), fall back to the legacy
    // projects.parent_project_id column through migration 0012.
    const preview = ctx.db.getProject(previewId);
    const previewService = preview ? ctx.db.getService(`${previewId}__svc`) : undefined;
    const previewParentId =
      previewService?.parent_service_id?.replace(/__svc$/, '') ?? preview?.parent_project_id;
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

  // ---------------------------------------------------------------------------
  // rc.1: 308 redirects for /api/services/:id and /api/managed-services/:id
  // when the :id resolves to a known project (app service). Implemented as
  // middleware (not a route handler) so unrecognised IDs fall through to
  // system-routes.ts which owns the managed-infrastructure service endpoints.
  // ---------------------------------------------------------------------------
  api.use('/services/:id', async (c, next) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (project) {
      return c.redirect(`/api/projects/${project.id}/services/${project.id}`, 308);
    }
    await next();
  });

  api.get('/managed-services/:id', (c) => {
    const id = c.req.param('id');
    // /managed-services/:id has no legacy handler — always redirect to canonical shape.
    // Use the id as both :p and :s (managed services map 1:1 to their project scope in rc.1).
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    const projectId = project?.id ?? id;
    return c.redirect(`/api/projects/${projectId}/services/${id}`, 308);
  });

  // ---------------------------------------------------------------------------
  // Canonical REST aliases — /projects/:p/services/:s/<verb>
  // Each handler reads :p (project id/name) and :s (service/legacy project id)
  // from URL params, then delegates to the same logic as the legacy route by
  // temporarily mapping :s → :id in the request context.
  //
  // All canonical routes deliberately do NOT set X-Deprecated-Endpoint.
  // ---------------------------------------------------------------------------

  // Helper: override c.req.param('id') to return the :s (service) param so
  // legacy getProjectOrThrow calls resolve via the service/project id in :s.
  // Uses Context from hono (not the route-specific generic) to avoid inference issues.
  function withServiceAsId<T>(c: Context, fn: (c: Context) => T): T {
    const origParam = c.req.param.bind(c.req);
    const serviceId = (origParam as (name: string) => string)('s');
    // Monkey-patch param on this request instance only
    c.req.param = ((name?: string) => {
      if (name === 'id') return serviceId;
      if (name === undefined) {
        const all = (origParam as () => Record<string, string>)();
        return { ...all, id: serviceId };
      }
      return (origParam as (n: string) => string)(name);
    }) as typeof c.req.param;
    return fn(c);
  }

  // GET /projects/:p/services/:s/stats
  api.get('/projects/:p/services/:s/stats', async (c) => {
    return withServiceAsId(c, (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      // PR 4 canonical-first: prefer the deployable services row's
      // status + container_id; fall back to legacy projects columns
      // through 0012.
      const deployable = ctx.db.getDeployableForProject(project.id);
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

  // GET /projects/:p/services/:s  (single service detail)
  // rc.2 §6.6: handler resolves the project (group) via :p directly, and
  // the service via :s against the unified `services` table. Backwards-
  // compatible with the rc.1 contract where :s == :p == legacy project id
  // (fall through to the legacy projects row in that case).
  api.get('/projects/:p/services/:s', (c) => {
    const pParam = c.req.param('p');
    const sParam = c.req.param('s');
    const project = ctx.db.getProject(pParam) ?? ctx.db.getProjectByName(pParam);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${pParam}` }, 404);
    }

    // Resolve service via the unified table; auto-derived deployables
    // use id = `<projectId>__svc`. Managed services keep their original id.
    const serviceRow = ctx.db.getService(sParam) ?? ctx.db.getService(`${sParam}__svc`) ?? null;

    // Legacy fallback: when :s is the legacy project id (pre-migration
    // shape, test fixtures without 0009 backfill), resolve project ops
    // (env vars, deploy logs) via the legacy project row directly.
    const envVars = ctx.env.getAll(project.id);
    const environments = ctx.db.getEnvironmentsByProject(project.id);
    const deployLogs = ctx.db.getDeployLogs(project.id, 5);
    // PR 4 canonical-first: pass the auto-derived deployable so wire
    // emission reads canonical kind/image_url/assigned_port with fallback.
    const deployable = ctx.db.getDeployableForProject(project.id);

    return c.json({
      ...mapProjectForApi(project, deployable),
      // rc.2 canonical surface: unified `services` row alongside the
      // legacy project shape so consumers (Phase 3 frontend) can read
      // native columns without a second fetch.
      service: serviceRow
        ? {
            id: serviceRow.id,
            name: serviceRow.name,
            kind: serviceRow.kind,
            project_id: serviceRow.project_id,
            parent_service_id: serviceRow.parent_service_id,
            status: serviceRow.status,
            assigned_port: serviceRow.assigned_port,
            container_id: serviceRow.container_id,
            container_name: serviceRow.container_name,
            image_tag: serviceRow.image_tag,
            created_at: normalizeTimestamp(serviceRow.created_at),
            updated_at: normalizeTimestamp(serviceRow.updated_at),
          }
        : null,
      environments: environments.map((env) => mapEnvironment(project.name, env)),
      envVars,
      recentDeploys: deployLogs.map((dl) => ({
        ...dl,
        commitMessage: dl.commit_message ?? null,
      })),
    });
  });

  // PATCH /projects/:p/services/:s  (update config)
  api.patch('/projects/:p/services/:s', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const body = await cx.req
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
          : Array.isArray(imageCmdRaw) && imageCmdRaw.every((e) => typeof e === 'string')
            ? imageCmdRaw
            : typeof imageCmdRaw === 'string'
              ? imageCmdRaw
                  .split(' ')
                  .map((p) => p.trim())
                  .filter((p) => p.length > 0)
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
        return cx.json(
          { error: 'INVALID_FIELD', message: 'containerPort must be a valid integer' },
          400,
        );
      }
      if (containerPort !== undefined && (containerPort < 1 || containerPort > 65535)) {
        return cx.json(
          { error: 'INVALID_FIELD', message: 'containerPort must be between 1 and 65535' },
          400,
        );
      }
      ctx.db.updateProject(project.id, {
        imageUrl,
        imageCmd: imageCmd ? JSON.stringify(imageCmd) : null,
        containerPort,
      });
      const updated = ctx.db.getProject(project.id);
      if (!updated) return cx.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
      // PR 4 canonical-first: re-read deployable after mutation so wire
      // emission reflects the post-update canonical state.
      const updatedDeployable = ctx.db.getDeployableForProject(updated.id);
      return cx.json(mapProjectForApi(updated, updatedDeployable));
    });
  });

  // GET /projects/:p/services/:s/topology
  api.get('/projects/:p/services/:s/topology', async (c) => {
    return withServiceAsId(c, (cx) => {
      // Re-use the same logic as /projects/:id/topology by faking the inner
      // request and delegating to the existing handler via a sub-request.
      // Simpler: inline the same response shape using the resolved project.
      const project = getProjectOrThrow(cx, ctx);
      try {
        const childProjects = ctx.db.getChildProjects(project.id);
        const nodes = childProjects.length > 0 ? childProjects : [project];
        const nodeIds = new Set(nodes.map((n) => n.id));
        const dependsOnMap = new Map<string, string[]>();
        for (const node of nodes) {
          const deps = ctx.db.findDependenciesByProject(node.id);
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
        return Promise.all(
          nodes.map(async (node) => {
            // PR 4 canonical-first: deployable services row drives port,
            // image, and runtime status when present.
            const deployable = ctx.db.getDeployableForProject(node.id);
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
        ).then((serviceNodes) => cx.json({ services: serviceNodes }));
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

  // ---------------------------------------------------------------------------
  // rc.2 §6.6 — resolveServiceForRequest helper.
  //
  // Resolves a (`:p` group, `:s` service) URL pair into a `services` row from
  // the unified post-0009 schema. Falls back to the legacy `projects` row by
  // id/name (P1 retains all legacy deployable columns on `projects`) so call
  // sites that still expect a ProjectRow shape keep working through P2.
  //
  // Returns either a resolved `{ project, service }` pair or a Response (404).
  // ---------------------------------------------------------------------------
  function resolveServiceForRequest(
    c: Context,
  ): { project: ProjectRow; service: ReturnType<typeof ctx.db.getService> | null } | Response {
    const p = c.req.param('p') ?? '';
    const s = c.req.param('s') ?? '';
    const project = ctx.db.getProject(p) ?? ctx.db.getProjectByName(p);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${p}` }, 404);
    }
    // services.id either == legacy project_id (rare, pre-migration) or
    // == legacy_project_id + '__svc' for auto-derived deployables, or
    // == original managed_service_id (managed kinds).
    const service = ctx.db.getService(s) ?? ctx.db.getService(`${s}__svc`) ?? null;
    return { project, service };
  }

  // GET /projects/:p/services (list all managed services connected to project)
  // Also exposed as GET /projects/:p/managed-services (managed-only alias)
  const listManagedServicesHandler = (c: Context) => {
    const projectId = c.req.param('p') ?? '';
    const project = ctx.db.getProject(projectId) ?? ctx.db.getProjectByName(projectId);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectId}` }, 404);
    }
    const connections = ctx.db.listServiceConnectionsByProject(project.id);
    const services = connections
      .map((conn) => ctx.db.getService(conn.service_id_provider))
      .filter((svc) => svc !== undefined);
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
  };

  api.get('/projects/:p/managed-services', listManagedServicesHandler);

  // Re-export for tests + future internal call sites; intentional unused
  // suppress because the helper is consumed only by rc.2 P2 tests today.
  void resolveServiceForRequest;

  // POST /projects/:p/services/:s/start
  api.post('/projects/:p/services/:s/start', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      try {
        assertProjectLifecycleMutable(project, 'start', ctx);
      } catch (err) {
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        throw err;
      }
      // PR 4 canonical-first: container_id from deployable services row.
      const deployable = ctx.db.getDeployableForProject(project.id);
      const containerId = deployable?.container_id ?? project.container_id;
      if (!containerId) {
        return cx.json({ error: 'No container to start. Redeploy instead.' }, 400);
      }
      await ctx.pipeline.start(project.id);
      return cx.json({ status: 'started', project: project.name });
    });
  });

  // POST /projects/:p/services/:s/stop
  api.post('/projects/:p/services/:s/stop', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      try {
        assertProjectLifecycleMutable(project, 'stop', ctx);
      } catch (err) {
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        throw err;
      }
      const lockSessionId = `stop-${project.id}-${Date.now().toString(36)}`;
      if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
        const lock = ctx.agentPool.getProjectLock(project.id);
        return cx.json(
          new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(),
          409,
        );
      }
      try {
        ctx.coordinator.suppressProject(project.id, 60_000);
        await ctx.pipeline.stop(project.id);
        return cx.json({ status: 'stopped', project: project.name });
      } finally {
        ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
      }
    });
  });

  // POST /projects/:p/services/:s/restart
  api.post('/projects/:p/services/:s/restart', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      try {
        assertProjectLifecycleMutable(project, 'stop', ctx);
      } catch (err) {
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        throw err;
      }
      const lockSessionId = `restart-${project.id}-${Date.now().toString(36)}`;
      if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
        const lock = ctx.agentPool.getProjectLock(project.id);
        return cx.json(
          new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(),
          409,
        );
      }
      try {
        ctx.coordinator.suppressProject(project.id, 30_000);
        await ctx.pipeline.stop(project.id);
        await ctx.pipeline.start(project.id);
        return cx.json({ status: 'restarted', project: project.name });
      } finally {
        ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
      }
    });
  });

  // POST /projects/:p/services/:s/deploy  (alias for /redeploy — Task 1 §5)
  api.post('/projects/:p/services/:s/deploy', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      try {
        assertProjectMutable(project, ctx);
      } catch (err) {
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        throw err;
      }
      const strategy = (cx.req.query('strategy') ?? 'force') as 'blue-green' | 'force';
      const body = await cx.req
        .json<{
          env_vars?: Record<string, string>;
          no_cache?: boolean;
          health_check_path?: string;
        }>()
        .catch(() => ({ env_vars: undefined, no_cache: undefined, health_check_path: undefined }));
      if (body.env_vars && typeof body.env_vars === 'object') {
        for (const [key, value] of Object.entries(body.env_vars)) {
          if (value.trim()) ctx.env.set(project.id, key, value.trim());
        }
      }
      // PR 4 canonical-first: source from deployable services row.
      const deployable = ctx.db.getDeployableForProject(project.id);
      const projectSource = deployable?.source ?? project.source;
      if (projectSource === 'git' && !project.repo_url) {
        return cx.json({ success: false, error: 'Missing repo URL for git redeploy' }, 400);
      }
      const lockSessionId = `redeploy-${project.id}-${Date.now().toString(36)}`;
      if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
        const lock = ctx.agentPool.getProjectLock(project.id);
        return cx.json(
          new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(),
          409,
        );
      }
      try {
        ctx.coordinator.suppressProject(project.id, 120_000);
        ctx.db.updateProject(project.id, { status: 'building' });
        const result = await ctx.pipeline.redeploy(project.id, {
          noCache: body.no_cache,
          strategy,
          healthCheckPath: body.health_check_path,
        });
        return cx.json(result, result.success ? 200 : 500);
      } catch (err) {
        if (err instanceof DeployLockedError) return cx.json(err.toJSON(), 409);
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        if (err instanceof OpenLanderError) return cx.json(err.toJSON(), err.statusCode as 400);
        ctx.db.updateProject(project.id, { status: 'error' });
        const errMsg = err instanceof Error ? err.message : String(err);
        return cx.json({ success: false, error: errMsg }, 500);
      } finally {
        ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
      }
    });
  });

  // POST /projects/:p/services/:s/archive
  api.post('/projects/:p/services/:s/archive', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      try {
        assertProjectLifecycleMutable(project, 'archive', ctx);
      } catch (err) {
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return cx.json(err.toJSON(), 409);
        }
        throw err;
      }
      const lockSessionId = `archive-${project.id}-${Date.now().toString(36)}`;
      if (ctx.agentPool && !ctx.agentPool.acquireProjectLock(project.id, lockSessionId)) {
        const lock = ctx.agentPool.getProjectLock(project.id);
        return cx.json(
          new DeployLockedError(project.id, lock?.sessionId ?? 'unknown').toJSON(),
          409,
        );
      }
      try {
        ctx.coordinator.suppressProject(project.id, 60_000);
        await ctx.pipeline.archive(project.id);
        const updated = ctx.db.getProject(project.id);
        return cx.json({ project: updated });
      } finally {
        ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
      }
    });
  });

  // POST /projects/:p/services/:s/unarchive
  api.post('/projects/:p/services/:s/unarchive', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      await ctx.pipeline.unarchive(project.id);
      const updated = ctx.db.getProject(project.id);
      return cx.json({ project: updated });
    });
  });

  // GET /projects/:p/services/:s/logs
  api.get('/projects/:p/services/:s/logs', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const lines = parseInt(cx.req.query('lines') ?? '50', 10);
      const logs = await ctx.pipeline.getLogs(project.id, lines);
      return cx.json({ project: project.name, logs });
    });
  });

  // GET /projects/:p/services/:s/env
  api.get('/projects/:p/services/:s/env', (c) => {
    return withServiceAsId(c, (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const vars = ctx.env.getAll(project.id);
      return cx.json({ project: project.name, envVars: vars });
    });
  });

  // POST /projects/:p/services/:s/env
  api.post('/projects/:p/services/:s/env', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const body = await cx.req.json<{ variables?: Record<string, string> }>();
      if (!body.variables) {
        return cx.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
      }
      const changed = ctx.env.setBulk(project.id, body.variables);
      // PR 4 canonical-first: status from deployable services row.
      const deployable = ctx.db.getDeployableForProject(project.id);
      const projectStatus = deployable?.status ?? project.status;
      return cx.json({
        status: changed ? 'updated' : 'unchanged',
        project: project.name,
        keys: Object.keys(body.variables),
        needsRedeploy: changed && projectStatus === 'running',
      });
    });
  });

  // GET /projects/:p/services/:s/deployments
  api.get('/projects/:p/services/:s/deployments', (c) => {
    return withServiceAsId(c, (cx) => {
      // 404 if project missing (throws ProjectNotFoundError), discard the row.
      getProjectOrThrow(cx, ctx);
      const limit = parseInt(cx.req.query('limit') ?? '50', 10);
      const environmentId = cx.req.query('environmentId');
      // CCG #5 (post-0012 multi-svc gap): the legacy call passed project.id,
      // which projectIdToServiceId resolved to `${project.id}__svc` — fine for
      // single-svc projects but invisible for sibling services in a grouped
      // project. Pass the canonical service id from the URL so each service's
      // deploy history shows up under its own detail page.
      const serviceId = cx.req.param('s') ?? '';
      const deployLogs = ctx.db.getDeployLogs(serviceId, limit, environmentId);
      return cx.json({
        count: deployLogs.length,
        deployments: deployLogs.map((dl) => ({
          id: dl.id,
          status: dl.status,
          trigger: dl.trigger,
          triggerDetail: dl.trigger_detail,
          commitSha: dl.commit_sha,
          commitMessage: dl.commit_message ?? null,
          durationMs: dl.duration_ms,
          createdAt: normalizeTimestamp(dl.created_at),
          failureSummary: dl.status === 'failed' ? extractFailureSummary(dl.build_log) : null,
        })),
      });
    });
  });

  // POST /projects/:p/services/:s/expose
  api.post('/projects/:p/services/:s/expose', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      // PR 4 canonical-first: assigned_port from deployable services row.
      const deployable = ctx.db.getDeployableForProject(project.id);
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

  // POST /projects/:p/services/:s/unexpose
  api.post('/projects/:p/services/:s/unexpose', (c) => {
    return withServiceAsId(c, (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      ctx.pipeline.closeTunnel(project.id);
      return cx.json({ status: 'unexposed', project: project.name });
    });
  });

  // GET /projects/:p/services/:s/webhooks
  api.get('/projects/:p/services/:s/webhooks', (c) => {
    return withServiceAsId(c, (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const configs = ctx.db.getWebhookConfigs(project.id);
      return cx.json({
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
  });

  // POST /projects/:p/services/:s/webhooks
  api.post('/projects/:p/services/:s/webhooks', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const body = await cx.req
        .json<{ source: string; branch_filter?: string; enabled?: boolean }>()
        .catch(() => ({ source: '', branch_filter: undefined, enabled: undefined }));
      if (!body.source || !['github', 'gitlab', 'bitbucket'].includes(body.source)) {
        return cx.json({ error: 'Invalid source. Must be github, gitlab, or bitbucket.' }, 400);
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
        return cx.json({ error: 'Failed to configure webhook' }, 500);
      }
      return cx.json({
        id: config.id,
        source: config.source,
        secret: config.secret,
        branchFilter: config.branch_filter,
        enabled: config.enabled === 1,
        webhookUrl: `/api/webhooks/${project.id}/${config.source}`,
      });
    });
  });

  // GET /projects/:p/services/:s/previews
  api.get('/projects/:p/services/:s/previews', (c) => {
    return withServiceAsId(c, (cx) => {
      const project = getProjectOrThrow(cx, ctx);
      const previews = ctx.db.getPreviewProjects(project.id);
      return cx.json({
        previews: previews.map((preview) => {
          // PR 4 canonical-first: per-preview deployable services row.
          const deployable = ctx.db.getDeployableForProject(preview.id);
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
      });
    });
  });

  return api;
}
