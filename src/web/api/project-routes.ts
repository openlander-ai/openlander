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
  ProjectSourceRemovedError,
  ServiceSelectionRequiredError,
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
  type LifecycleAction,
  type MutationPolicyCtx,
} from '../../pipeline/mutation-policy.js';
import {
  getEnvironmentByIdOrThrow,
  getProjectOrThrow,
  resolveEnvironmentByType,
} from './helpers/project-helpers.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { projectIdToServiceId } from '../../db/repos/deploy-log.repo.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';

const log = createModuleLogger('api');
type DeployableServiceRow = Awaited<ReturnType<AppContext['db']['getDeployablesByGroup']>>[number];

type SingleDeployableSelection =
  | { service: DeployableServiceRow; error: null }
  | { service: null; error: ServiceSelectionRequiredError };

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

/**
 * Cap how many Docker inspect+stats calls fly in parallel during a single
 * topology cold-load. Six is a balance: enough to keep the wall-time short
 * for a 30-node group, low enough that the Docker socket / daemon doesn't
 * thrash. The TTL cache + in-flight dedupe above already collapse repeat
 * polls — this only matters for the cold path.
 */
const TOPOLOGY_INSPECT_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item === undefined) continue;
      results[idx] = await worker(item, idx);
    }
  });
  await Promise.all(runners);
  return results;
}

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
  /** Service id used as the service_metrics lookup key. */
  id: string;
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

  const invalidateProjectContainers = async (projectId: string): Promise<void> => {
    try {
      const project = await ctx.db.getProject(projectId);
      if (project) {
        // Project routes are compatibility surfaces; container ownership lives
        // on the deployable service row post-0012.
        const deployable =
          typeof ctx.db.getDeployableForProject === 'function'
            ? await ctx.db.getDeployableForProject(projectId)
            : undefined;
        invalidateTopologyNodeCache(deployable?.container_id ?? project.container_id);
      }
      // Prefer service-hierarchy compose children; keep getChildProjects only
      // as a fixture/back-compat fallback for narrow tests.
      const children =
        typeof ctx.db.getComposeChildProjects === 'function'
          ? await ctx.db.getComposeChildProjects(projectId)
          : typeof ctx.db.getChildProjects === 'function'
            ? await ctx.db.getChildProjects(projectId)
            : [];
      for (const child of children) {
        const childDeployable =
          typeof ctx.db.getDeployableForProject === 'function'
            ? await ctx.db.getDeployableForProject(child.id)
            : undefined;
        invalidateTopologyNodeCache(childDeployable?.container_id ?? child.container_id);
      }
    } catch (err) {
      log.debug({ err, projectId }, 'topology cache invalidation lookup failed');
    }
  };

  ctx.eventBus.on('deploy:success', (payload) => {
    void invalidateProjectContainers(payload.projectId);
  });
  ctx.eventBus.on('deploy:failed', (payload) => {
    void invalidateProjectContainers(payload.projectId);
  });
  // Compose deploys never emit deploy:success / deploy:failed — they emit
  // compose:up / compose:failed instead. Without these subscriptions the
  // topology cache stayed stale for the full 15s TTL after a compose
  // rollout or failure (Codex MEDIUM-1).
  ctx.eventBus.on('compose:up', (payload) => {
    void invalidateProjectContainers(payload.projectId);
  });
  ctx.eventBus.on('compose:failed', (payload) => {
    void invalidateProjectContainers(payload.projectId);
  });
}

/** Service-metrics rows older than this are treated as stale and the
 *  display falls back to '—'. Matches the monitor's polling cadence
 *  (sample every 30s, two missed samples ⇒ stale). */
const TOPOLOGY_METRIC_FRESHNESS_MS = 90_000;

async function fetchTopologyNodeRuntime(
  ctx: Pick<AppContext, 'docker' | 'db'>,
  node: TopologyNode,
): Promise<TopologyNodeRuntime> {
  let cpuDisplay = '—';
  let memDisplay = '—';

  // Pull cpu/mem from `service_metrics` instead of fanning out a
  // Docker stats RPC per node on every cold load. The recorder hook
  // (ServiceHealthMonitor.runServiceCheck) populates this table on
  // every poll, so a fresh row is the same number Docker would give
  // us — minus the per-node 1-2s socket round trip that previously
  // dominated /api/projects topology fan-out.
  const getLatestServiceMetric =
    typeof ctx.db.getLatestServiceMetric === 'function'
      ? ctx.db.getLatestServiceMetric.bind(ctx.db)
      : undefined;
  if (node.container_id && node.status === 'running') {
    if (getLatestServiceMetric) {
      const sample = await getLatestServiceMetric(node.id);
      if (sample && Date.now() - sample.recorded_at < TOPOLOGY_METRIC_FRESHNESS_MS) {
        const cpuPct = Number.isFinite(sample.cpu) ? Math.round(sample.cpu * 10) / 10 : null;
        if (cpuPct !== null) {
          cpuDisplay = `${String(cpuPct)}%`;
        }
        const memMb = Number.isFinite(sample.mem) ? Math.round(sample.mem) : null;
        if (memMb !== null) {
          memDisplay = `${String(memMb)} MB`;
        }
      }
    } else {
      // Narrow test fixtures and older embedded contexts may omit the metrics
      // repo. Keep the legacy Docker stats fallback so topology still works.
      try {
        const stats = await ctx.docker.getContainerStats(node.container_id);
        const s = stats as {
          cpu_stats: {
            cpu_usage: { total_usage: number; percpu_usage?: number[] };
            system_cpu_usage: number;
            online_cpus?: number;
          };
          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
          memory_stats: { usage: number; limit: number };
        };
        const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
        const systemDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
        const cpuCount = s.cpu_stats.cpu_usage.percpu_usage?.length ?? s.cpu_stats.online_cpus ?? 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
        cpuDisplay = `${String(Math.round(cpuPercent * 10) / 10)}%`;
        memDisplay = `${String(Math.round(s.memory_stats.usage / 1024 / 1024))} MB`;
      } catch {
        // Leave displays as '—'; health is still inspected below.
      }
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
  ctx: Pick<AppContext, 'docker' | 'db'>,
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
  visibility?: ProjectRow['visibility'];
  parent_service_id?: string | null;
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
  const status = deployable?.status ?? project.status ?? 'idle';
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

  const parentProjectFallback = project.parent_project_id ?? null;
  // eslint-disable-next-line openlander-internal/no-dropped-columns -- compatibility alias until project-row deployable fields are removed from callers
  const visibilityFallback = project.visibility;
  const parentProjectId = deployable?.parent_service_id
    ? deployableServiceIdToProjectId(deployable.parent_service_id)
    : parentProjectFallback;
  const visibility = deployable?.visibility ?? visibilityFallback ?? 'internal';

  return {
    // --- Identity / group fields (live on `projects` permanently) ---
    id: project.id,
    name: project.name,
    parent_project_id: parentProjectId,
    visibility,
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

  const legacyNoTimezone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalizedInput = legacyNoTimezone.test(trimmed)
    ? trimmed.replace(' ', 'T') + 'Z'
    : trimmed;
  const parsed = new Date(normalizedInput);

  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString();
}

async function createMutationPolicySnapshot(
  ctx: AppContext,
  project: ProjectRow,
): Promise<MutationPolicyCtx> {
  const [deployable, circuitBreakerOpen] = await Promise.all([
    ctx.db.getDeployableForProject(project.id),
    ctx.db.isCircuitBreakerOpen(project.id),
  ]);

  return {
    db: {
      getDeployableForProject: (projectId) => (projectId === project.id ? deployable : undefined),
      isCircuitBreakerOpen: (projectId) => projectId === project.id && circuitBreakerOpen,
    },
  };
}

async function getSingleDeployableOrSelectionError(
  ctx: AppContext,
  project: ProjectRow,
): Promise<SingleDeployableSelection> {
  const deployables = await ctx.db.getDeployablesByGroup(project.id);
  const actionable = deployables.filter((svc) => svc.kind !== 'compose-child');
  const onlyService = actionable.length === 1 ? actionable[0] : undefined;
  if (onlyService) {
    return { service: onlyService, error: null };
  }
  return {
    service: null,
    error: new ServiceSelectionRequiredError(
      project.id,
      project.name,
      actionable.map((svc) => ({
        serviceId: svc.id,
        serviceName: svc.name,
        kind: svc.kind,
        source: svc.source,
      })),
    ),
  };
}

async function assertProjectMutableForRoute(project: ProjectRow, ctx: AppContext): Promise<void> {
  assertProjectMutable(project, await createMutationPolicySnapshot(ctx, project));
}

async function assertProjectLifecycleMutableForRoute(
  project: ProjectRow,
  action: LifecycleAction,
  ctx: AppContext,
): Promise<void> {
  assertProjectLifecycleMutable(project, action, await createMutationPolicySnapshot(ctx, project));
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
    const repoUrl = body.repo_url?.trim() || undefined;
    const explicitName = body.name?.trim();

    if (repoUrl || body.branch !== undefined) {
      return c.json(new ProjectSourceRemovedError().toJSON(), 400);
    }

    const projectName = explicitName;
    if (!projectName) {
      return c.json(
        { error: 'MISSING_FIELD', code: 'MISSING_FIELD', message: 'name is required' },
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

    const existing = await ctx.db.getProjectByName(projectName);
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

    const projectId = crypto.randomUUID();
    const created = await ctx.db.createProjectGroup({
      id: projectId,
      name: projectName,
    });

    return c.json({
      project: {
        id: created.id,
        name: created.name,
        status: created.status ?? 'idle',
      },
    });
  });

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

  api.get('/projects', async (c) => {
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
    const projectsWithMeta = await ctx.db.listProjectsWithMetadata(status, { includeArchived });
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
        // p is already hydrated by ProjectRepo from its canonical service row;
        // route through the same mapper as detail endpoints so aliases stay
        // aligned while the wire shape remains unchanged.
        const mapped = mapProjectForApi(p);
        return {
          id: mapped.id,
          name: mapped.name,
          status: mapped.status,
          visibility: mapped.visibility,
          source: mapped.source,
          port: mapped.port,
          url: mapped.port ? getProjectUrl(mapped.name) : null,
          urls: mapped.port
            ? ips.map((ip) => ({
                url: `http://${mapped.name}.${ip.address}.sslip.io`,
                type: ip.type,
                ip: ip.address,
              }))
            : [],
          publicUrl: mapped.publicUrl,
          ...(mapped.imageUrl ? { imageUrl: mapped.imageUrl } : {}),
          createdAt: mapped.created_at,
          updatedAt: mapped.updated_at,
          parentProjectId: mapped.parent_project_id,
          isCompose,
          serviceCount: childCount,
          environments: environments.map((env) => mapEnvironment(mapped.name, env)),
        };
      }),
    });
  });

  api.get('/projects/:id', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const envVars = await ctx.env.getAll(project.id);
    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    const deployLogs = await ctx.db.getDeployLogs(project.id, 5);
    // PR 4 canonical-first: fetch the deployable service row once and
    // pass into mapProjectForApi so wire emission reads canonical fields
    // (kind/image_url/assigned_port) with `??` fallback.
    const deployable = await ctx.db.getDeployableForProject(project.id);

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

      const nodeIds = new Set(
        useServices
          ? groupServices.map((s) => s.id)
          : (childProjects.length > 0 ? childProjects : [project]).map((n) => n.id),
      );

      // Build dependsOn map: for each node, find its project_dependencies
      // whose target_service_id is another node in this topology.
      const dependsOnMap = new Map<string, string[]>();
      const dependencyIdSource = useServices
        ? groupServices.map((s) => deployableServiceIdToProjectId(s.id))
        : (childProjects.length > 0 ? childProjects : [project]).map((n) => n.id);
      for (const lookupId of dependencyIdSource) {
        const deps = await ctx.db.findDependenciesByProject(lookupId);
        const siblingDeps = deps
          .map((d) => d.target_service_id)
          .filter((sid): sid is string => sid !== null && nodeIds.has(sid));
        const nodeId = useServices ? projectIdToDeployableServiceId(lookupId) : lookupId;
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

      // Inspect health for all nodes — funneled through per-container 15s
      // TTL cache + in-flight dedupe + a 6-wide concurrency limiter so a
      // 30-node group doesn't open 60 simultaneous Docker calls.
      const serviceNodes = useServices
        ? await mapWithConcurrency(groupServices, TOPOLOGY_INSPECT_CONCURRENCY, async (svc) => {
            const port = svc.assigned_port ?? null;
            // Display name strips __svc suffix and group-name prefix.
            const displayName = deployableServiceIdToProjectId(svc.name);
            const url = port ? getProjectUrl(displayName) : null;
            const image = svc.image_url ?? svc.image_tag ?? `${displayName}:latest`;
            const kind = resolveKind(svc.kind);
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
            };
          })
        : await mapWithConcurrency(
            childProjects.length > 0 ? childProjects : [project],
            TOPOLOGY_INSPECT_CONCURRENCY,
            async (node) => {
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

  api.patch('/projects/:id', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

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

    await ctx.db.updateProject(project.id, {
      imageUrl,
      imageCmd: imageCmd ? JSON.stringify(imageCmd) : null,
      containerPort,
    });

    const updatedProject = await ctx.db.getProject(project.id);
    if (!updatedProject) {
      return c.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
    }

    // PR 4 canonical-first: re-read deployable after mutation.
    const updatedDeployable = await ctx.db.getDeployableForProject(updatedProject.id);
    return c.json(mapProjectForApi(updatedProject, updatedDeployable));
  });

  api.post('/projects/:id/environments', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment creation is disabled' }, 410);
  });

  api.get('/projects/:id/environments', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    return c.json({ environments: environments.map((env) => mapEnvironment(project.name, env)) });
  });

  api.get('/projects/:id/environments/:envId', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    return c.json({ environment: mapEnvironment(project.name, environment) });
  });

  api.delete('/projects/:id/environments/:envId', (_c) => {
    return _c.json({ error: 'FEATURE_FROZEN', message: 'Environment deletion is disabled' }, 410);
  });

  api.get('/projects/:id/environments/:envId/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const envVars = await ctx.env.getAllWithInheritance(project.id, environment.id);
    const inheritance = ctx.env.getInheritanceInfo(project.id, environment.id);

    return c.json({
      environment: mapEnvironment(project.name, environment),
      envVars,
      inheritance,
    });
  });

  api.post('/projects/:id/environments/:envId/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const environment = await getEnvironmentByIdOrThrow(c, ctx, project.id);
    if (environment instanceof Response) {
      return environment;
    }

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = await ctx.env.setBulk(project.id, body.variables, environment.id);
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
  api.get('/projects/:id/services', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const deployables = await ctx.db.getServices({
      project_id: project.id,
      kindNotIn: MANAGED_SERVICE_KINDS,
    });
    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    return c.json({
      count: deployables.length,
      services: deployables.map((svc) => ({
        id: svc.id,
        // v5.1: strip the `__svc` suffix from the display name. The suffix is
        // an internal convention from the post-0009 service-id scheme and
        // should never reach the user (the topology endpoint already does
        // this — same treatment here for the deployables list).
        name: deployableServiceIdToProjectId(svc.name),
        kind: svc.kind,
        status: svc.status,
        assigned_port: svc.assigned_port,
        container_id: svc.container_id,
        container_name: svc.container_name,
        image_tag: svc.image_tag,
        source: svc.source,
        repoUrl: svc.repo_url,
        branch: svc.branch,
        deployedBranch:
          environments.find((env) => env.service_id === svc.id && env.type === 'production')
            ?.branch ?? null,
        dockerfilePath: svc.dockerfile_path,
        dockerTarget: svc.docker_target,
        buildContext: svc.build_context,
        buildMethod: svc.build_method,
        created_at: normalizeTimestamp(svc.created_at),
        updated_at: normalizeTimestamp(svc.updated_at),
      })),
    });
  });

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
    await ctx.db.updateServiceConnection(connection.id, {
      autoInjectedEnvKeys: JSON.stringify(injectedKeys),
    });

    // Auto-sync dependency
    try {
      await ctx.db.createProjectDependency({
        source_service_id: projectIdToDeployableServiceId(project.id),
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

    // Auto-remove dependency
    try {
      const deps = await ctx.db.findDependenciesByProject(project.id);
      const matchingDep = deps.find(
        (d) => d.target_service_id === serviceId && d.source === 'auto',
      );
      if (matchingDep) await ctx.db.deleteProjectDependency(matchingDep.id);
    } catch {
      // dependency cleanup is best-effort
    }

    return c.json({ message: 'Service disconnected', serviceId });
  });

  // --- Deployment History ---

  api.get('/projects/:id/deployments', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const environmentId = c.req.query('environmentId');
    const logs = await ctx.db.getDeployLogs(project.id, limit, environmentId);

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

  api.get('/projects/:id/deployments/:deployId', async (c) => {
    const deployId = c.req.param('deployId');
    const project = await getProjectOrThrow(c, ctx);

    const log = await ctx.db.getDeployLog(deployId);
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
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectLifecycleMutableForRoute(project, 'start', ctx);
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

    // Project compatibility route: read container_id from the deployable
    // service row, then use ProjectRow compatibility aliases.
    const deployable = await ctx.db.getDeployableForProject(project.id);
    const containerId = deployable?.container_id ?? project.container_id;
    if (!containerId) {
      return c.json({ error: 'No container to start. Redeploy instead.' }, 400);
    }

    await ctx.pipeline.start(project.id);
    return c.json({ status: 'started', project: project.name });
  });

  api.post('/projects/:id/stop', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectLifecycleMutableForRoute(project, 'stop', ctx);
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
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectMutableForRoute(project, ctx);
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
          await ctx.env.set(project.id, key, value.trim());
        }
      }
    }

    const selection = await getSingleDeployableOrSelectionError(ctx, project);
    if (selection.error) {
      return c.json(selection.error.toJSON(), 400);
    }

    // PR 4 canonical-first: source is on services post-0009 too. Read
    // canonical with legacy fallback.
    const deployable = selection.service;
    const projectSource = deployable.source;
    if (projectSource === 'git' && !deployable.repo_url) {
      return c.json(
        { success: false, error: 'SERVICE_SOURCE_MISSING', code: 'SERVICE_SOURCE_MISSING' },
        400,
      );
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
      await ctx.db.updateProject(project.id, { status: 'building' });
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
      await ctx.db.updateProject(project.id, { status: 'error' });
      const errMsg = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: errMsg }, 500);
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  // v0.3: Rollback
  api.post('/projects/:id/rollback', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectMutableForRoute(project, ctx);
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

    const environmentResolution = await resolveEnvironmentByType(c, ctx, project);
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;
    const selection = await getSingleDeployableOrSelectionError(ctx, project);
    if (selection.error) {
      return c.json(selection.error.toJSON(), 400);
    }

    const body = await c.req
      .json<{ deployment_id?: unknown }>()
      .catch(() => ({ deployment_id: undefined }));
    const deploymentId =
      typeof body.deployment_id === 'string' && body.deployment_id.trim().length > 0
        ? body.deployment_id.trim()
        : undefined;

    if (deploymentId) {
      const deployment = await ctx.db.getDeployLog(deploymentId);
      const expectedServiceId = projectIdToServiceId(project.id);
      if (!deployment || deployment.service_id !== expectedServiceId) {
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

      await ctx.db.updateProject(project.id, { previousImageTag: imageTag });
      if (environmentRow) {
        await ctx.db.updateEnvironment(environmentRow.id, { previousImageTag: imageTag });
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
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectMutableForRoute(project, ctx);
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
  api.get('/projects/:id/webhooks', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const configs = await ctx.db.getWebhookConfigs(project.id);
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
    const project = await getProjectOrThrow(c, ctx);
    const body = await c.req.json<{ source: string; branch_filter?: string; enabled?: boolean }>();
    if (!body.source || !['github', 'gitlab', 'bitbucket'].includes(body.source)) {
      return c.json({ error: 'Invalid source. Must be github, gitlab, or bitbucket.' }, 400);
    }
    const source = body.source as 'github' | 'gitlab' | 'bitbucket';
    const existing = await ctx.db.getWebhookConfig(project.id, source);
    const secret = existing?.secret ?? `${project.id}.${crypto.randomUUID().replace(/-/g, '')}`;
    const configId = existing?.id ?? crypto.randomUUID();
    await ctx.db.setWebhookConfig({
      id: configId,
      projectId: project.id,
      source,
      secret,
      branchFilter: body.branch_filter ?? 'main',
      enabled: body.enabled !== false,
    });
    const config = await ctx.db.getWebhookConfig(project.id, source);
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

  api.delete('/projects/:id/webhooks/:source', async (c) => {
    const source = c.req.param('source');
    const project = await getProjectOrThrow(c, ctx);
    if (!['github', 'gitlab', 'bitbucket'].includes(source)) {
      return c.json({ error: 'Invalid source' }, 400);
    }
    await ctx.db.deleteWebhookConfig(project.id, source as 'github' | 'gitlab' | 'bitbucket');
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

  // --- Archive / Unarchive / Purge ---

  api.post('/projects/:id/archive', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectLifecycleMutableForRoute(project, 'archive', ctx);
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
      const updated = await ctx.db.getProject(project.id);
      return c.json({ project: updated });
    } finally {
      ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
    }
  });

  api.post('/projects/:id/unarchive', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    await ctx.pipeline.unarchive(project.id);
    const updated = await ctx.db.getProject(project.id);
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
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectLifecycleMutableForRoute(project, 'purge', ctx);
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
    const project = await getProjectOrThrow(c, ctx);

    try {
      await assertProjectLifecycleMutableForRoute(project, 'archive', ctx);
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

  api.get('/projects/:id/env', async (c) => {
    const project = await getProjectOrThrow(c, ctx);

    const vars = await ctx.env.getAll(project.id);
    return c.json({ project: project.name, envVars: vars });
  });

  api.get('/projects/:id/env-example', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const deployable = await ctx.db.getDeployableForProject(project.id);
    if (!deployable?.repo_url) {
      return c.json(
        {
          error: 'SERVICE_SOURCE_MISSING',
          code: 'SERVICE_SOURCE_MISSING',
          message: 'Service has no repository URL',
        },
        400,
      );
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

    const environmentResolution = await resolveEnvironmentByType(c, ctx, project, {
      requireExistingEnvironmentWhenAnyExists: true,
    });
    if ('response' in environmentResolution) {
      return environmentResolution.response;
    }
    const { environmentRow } = environmentResolution;

    let clonePath: string | null = null;
    try {
      const cloneResult = await cloneRepo({
        repoUrl: deployable.repo_url,
        branch: environmentRow?.branch ?? deployable.branch ?? undefined,
      });
      clonePath = cloneResult.path;
      const scanResult = scanForEnvUsage(clonePath);
      const existingVars = environmentRow
        ? await ctx.env.getAllWithInheritance(project.id, environmentRow.id)
        : await ctx.env.getAll(project.id);
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
    const project = await getProjectOrThrow(c, ctx);

    const body = await c.req.json<{ variables?: Record<string, string> }>();
    if (!body.variables) {
      return c.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
    }

    const changed = await ctx.env.setBulk(project.id, body.variables);
    // PR 4 canonical-first: status from deployable services row.
    const deployable = await ctx.db.getDeployableForProject(project.id);
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

  // ---------------------------------------------------------------------------
  // rc.1: 308 redirects for /api/services/:id and /api/managed-services/:id
  // when the :id resolves to a known project (app service). Implemented as
  // middleware (not a route handler) so unrecognised IDs fall through to
  // system-routes.ts which owns the managed-infrastructure service endpoints.
  // ---------------------------------------------------------------------------
  api.use('/services/:id', async (c, next) => {
    const id = c.req.param('id');
    const project = (await ctx.db.getProject(id)) ?? (await ctx.db.getProjectByName(id));
    if (project) {
      return c.redirect(`/api/projects/${project.id}/services/${project.id}`, 308);
    }
    await next();
  });

  api.get('/managed-services/:id', async (c) => {
    const id = c.req.param('id');
    // /managed-services/:id has no legacy handler — always redirect to canonical shape.
    // Use the id as both :p and :s (managed services map 1:1 to their project scope in rc.1).
    const project = (await ctx.db.getProject(id)) ?? (await ctx.db.getProjectByName(id));
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
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      // Project compatibility route: prefer the deployable service row's
      // status + container_id, then use ProjectRow compatibility aliases.
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

  // GET /projects/:p/services/:s  (single service detail)
  // rc.2 §6.6: handler resolves the project (group) via :p directly, and
  // the service via :s against the unified `services` table. Backwards-
  // compatible with the rc.1 contract where :s == :p == legacy project id
  // (fall through to the legacy projects row in that case).
  api.get('/projects/:p/services/:s', async (c) => {
    const pParam = c.req.param('p');
    const sParam = c.req.param('s');
    const project = (await ctx.db.getProject(pParam)) ?? (await ctx.db.getProjectByName(pParam));
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${pParam}` }, 404);
    }

    // Resolve service via the unified table; auto-derived deployables
    // use id = `<projectId>__svc`. Managed services keep their original id.
    const serviceRow =
      (await ctx.db.getService(sParam)) ??
      (await ctx.db.getService(projectIdToDeployableServiceId(sParam))) ??
      null;

    // Legacy fallback: when :s is the legacy project id (pre-migration
    // shape, test fixtures without 0009 backfill), resolve project ops
    // (env vars, deploy logs) via the legacy project row directly.
    const envVars = await ctx.env.getAll(project.id);
    const environments = await ctx.db.getEnvironmentsByProject(project.id);
    const deployLogs = await ctx.db.getDeployLogs(project.id, 5);
    // PR 4 canonical-first: pass the auto-derived deployable so wire
    // emission reads canonical kind/image_url/assigned_port with fallback.
    const deployable = await ctx.db.getDeployableForProject(project.id);

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
            source: serviceRow.source,
            repoUrl: serviceRow.repo_url,
            branch: serviceRow.branch,
            deployedBranch:
              environments.find(
                (env) => env.service_id === serviceRow.id && env.type === 'production',
              )?.branch ?? null,
            dockerfilePath: serviceRow.dockerfile_path,
            dockerTarget: serviceRow.docker_target,
            buildContext: serviceRow.build_context,
            buildMethod: serviceRow.build_method,
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
      const project = await getProjectOrThrow(cx, ctx);
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
      await ctx.db.updateProject(project.id, {
        imageUrl,
        imageCmd: imageCmd ? JSON.stringify(imageCmd) : null,
        containerPort,
      });
      const updated = await ctx.db.getProject(project.id);
      if (!updated) return cx.json({ error: 'NOT_FOUND', message: 'Project not found' }, 404);
      // PR 4 canonical-first: re-read deployable after mutation so wire
      // emission reflects the post-update canonical state.
      const updatedDeployable = await ctx.db.getDeployableForProject(updated.id);
      return cx.json(mapProjectForApi(updated, updatedDeployable));
    });
  });

  // GET /projects/:p/services/:s/topology
  api.get('/projects/:p/services/:s/topology', async (c) => {
    return withServiceAsId(c, async (cx) => {
      // Re-use the same logic as /projects/:id/topology by faking the inner
      // request and delegating to the existing handler via a sub-request.
      // Simpler: inline the same response shape using the resolved project.
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
            // PR 4 canonical-first: deployable services row drives port,
            // image, and runtime status when present.
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
  async function resolveServiceForRequest(
    c: Context,
  ): Promise<
    | { project: ProjectRow; service: Awaited<ReturnType<typeof ctx.db.getService>> | null }
    | Response
  > {
    const p = c.req.param('p') ?? '';
    const s = c.req.param('s') ?? '';
    const project = (await ctx.db.getProject(p)) ?? (await ctx.db.getProjectByName(p));
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${p}` }, 404);
    }
    // services.id either == legacy project_id (rare, pre-migration) or
    // == legacy_project_id + '__svc' for auto-derived deployables, or
    // == original managed_service_id (managed kinds).
    const service =
      (await ctx.db.getService(s)) ??
      (await ctx.db.getService(projectIdToDeployableServiceId(s))) ??
      null;
    return { project, service };
  }

  // GET /projects/:p/services (list all managed services connected to project)
  // Also exposed as GET /projects/:p/managed-services (managed-only alias)
  const listManagedServicesHandler = async (c: Context) => {
    const projectId = c.req.param('p') ?? '';
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
  };

  api.get('/projects/:p/managed-services', listManagedServicesHandler);

  // Re-export for tests + future internal call sites; intentional unused
  // suppress because the helper is consumed only by rc.2 P2 tests today.
  void resolveServiceForRequest;

  // POST /projects/:p/services/:s/start
  api.post('/projects/:p/services/:s/start', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      try {
        await assertProjectLifecycleMutableForRoute(project, 'start', ctx);
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
      const deployable = await ctx.db.getDeployableForProject(project.id);
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
      const project = await getProjectOrThrow(cx, ctx);
      try {
        await assertProjectLifecycleMutableForRoute(project, 'stop', ctx);
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
      const project = await getProjectOrThrow(cx, ctx);
      try {
        await assertProjectLifecycleMutableForRoute(project, 'stop', ctx);
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
      const project = await getProjectOrThrow(cx, ctx);
      try {
        await assertProjectMutableForRoute(project, ctx);
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
          if (value.trim()) await ctx.env.set(project.id, key, value.trim());
        }
      }
      // PR 4 canonical-first: source from deployable services row.
      const deployable = await ctx.db.getDeployableForProject(project.id);
      const projectSource = deployable?.source ?? project.source;
      if (projectSource === 'git' && !deployable?.repo_url) {
        return cx.json(
          { success: false, error: 'SERVICE_SOURCE_MISSING', code: 'SERVICE_SOURCE_MISSING' },
          400,
        );
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
        await ctx.db.updateProject(project.id, { status: 'building' });
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
        await ctx.db.updateProject(project.id, { status: 'error' });
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
      const project = await getProjectOrThrow(cx, ctx);
      try {
        await assertProjectLifecycleMutableForRoute(project, 'archive', ctx);
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
        const updated = await ctx.db.getProject(project.id);
        return cx.json({ project: updated });
      } finally {
        ctx.agentPool?.releaseProjectLock(project.id, lockSessionId);
      }
    });
  });

  // POST /projects/:p/services/:s/unarchive
  api.post('/projects/:p/services/:s/unarchive', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      await ctx.pipeline.unarchive(project.id);
      const updated = await ctx.db.getProject(project.id);
      return cx.json({ project: updated });
    });
  });

  // GET /projects/:p/services/:s/logs
  //
  // Per-service container logs. Supports both modes:
  //   - default JSON snapshot (?lines=N) for the static viewer
  //   - SSE/ndjson stream (?follow=true) for the live ConsoleLogViewer
  //
  // Falls back to 404 if the service id doesn't resolve under the named
  // project. Multi-service compose stacks land here (one service per
  // child) so the live tail is scoped to a single container instead of
  // the project-level interleave used by /projects/:id/logs.
  api.get('/projects/:p/services/:s/logs', async (c) => {
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
    const logs = containerId ? await ctx.docker.getLogs(containerId, tail) : '';
    return c.json({ project: project.name, service: service.name, logs });
  });

  // GET /projects/:p/services/:s/env
  api.get('/projects/:p/services/:s/env', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      const vars = await ctx.env.getAll(project.id);
      return cx.json({ project: project.name, envVars: vars });
    });
  });

  // POST /projects/:p/services/:s/env
  api.post('/projects/:p/services/:s/env', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      const body = await cx.req.json<{ variables?: Record<string, string> }>();
      if (!body.variables) {
        return cx.json({ error: 'MISSING_FIELD', message: 'variables object is required' }, 400);
      }
      const changed = await ctx.env.setBulk(project.id, body.variables);
      // PR 4 canonical-first: status from deployable services row.
      const deployable = await ctx.db.getDeployableForProject(project.id);
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
    return withServiceAsId(c, async (cx) => {
      // 404 if project missing (throws ProjectNotFoundError), discard the row.
      await getProjectOrThrow(cx, ctx);
      const limit = parseInt(cx.req.query('limit') ?? '50', 10);
      const environmentId = cx.req.query('environmentId');
      // CCG #5 (post-0012 multi-svc gap): the legacy call passed project.id,
      // which projectIdToDeployableServiceId resolved to `${project.id}__svc` — fine for
      // single-svc projects but invisible for sibling services in a grouped
      // project. Pass the canonical service id from the URL so each service's
      // deploy history shows up under its own detail page.
      const serviceId = cx.req.param('s') ?? '';
      const deployLogs = await ctx.db.getDeployLogs(serviceId, limit, environmentId);
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
      const project = await getProjectOrThrow(cx, ctx);
      // PR 4 canonical-first: assigned_port from deployable services row.
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

  // POST /projects/:p/services/:s/unexpose
  api.post('/projects/:p/services/:s/unexpose', async (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      ctx.pipeline.closeTunnel(project.id);
      return cx.json({ status: 'unexposed', project: project.name });
    });
  });

  // GET /projects/:p/services/:s/webhooks
  api.get('/projects/:p/services/:s/webhooks', (c) => {
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      const configs = await ctx.db.getWebhookConfigs(project.id);
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
      const project = await getProjectOrThrow(cx, ctx);
      const body = await cx.req
        .json<{ source: string; branch_filter?: string; enabled?: boolean }>()
        .catch(() => ({ source: '', branch_filter: undefined, enabled: undefined }));
      if (!body.source || !['github', 'gitlab', 'bitbucket'].includes(body.source)) {
        return cx.json({ error: 'Invalid source. Must be github, gitlab, or bitbucket.' }, 400);
      }
      const source = body.source as 'github' | 'gitlab' | 'bitbucket';
      const existing = await ctx.db.getWebhookConfig(project.id, source);
      const secret = existing?.secret ?? `${project.id}.${crypto.randomUUID().replace(/-/g, '')}`;
      const configId = existing?.id ?? crypto.randomUUID();
      await ctx.db.setWebhookConfig({
        id: configId,
        projectId: project.id,
        source,
        secret,
        branchFilter: body.branch_filter ?? 'main',
        enabled: body.enabled !== false,
      });
      const config = await ctx.db.getWebhookConfig(project.id, source);
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
    return withServiceAsId(c, async (cx) => {
      const project = await getProjectOrThrow(cx, ctx);
      const previews = await ctx.db.getPreviewProjects(project.id);
      return cx.json({
        previews: await Promise.all(
          previews.map(async (preview) => {
            // PR 4 canonical-first: per-preview deployable services row.
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

  // GET /deployments/recent
  //
  // Aggregate of the N most recent deploy_logs across all projects so
  // Home / dashboards can render the global last-deploy line in a
  // single round-trip instead of fanning out 1 query per project. The
  // earlier per-project loop in Home.tsx scaled with project count and
  // dominated cold-load time on multi-project workspaces.
  api.get('/deployments/recent', async (c) => {
    const limitParam = parseInt(c.req.query('limit') ?? '20', 10);
    const limit =
      Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 100 ? limitParam : 20;
    const rows = await ctx.db.listRecentDeployLogsAcrossProjects(limit);
    // Resolve service → project per row. Projects are keyed by id; the
    // small N (<=100) keeps per-row lookups cheap. Rows whose service
    // or project no longer exist are dropped — they shouldn't normally
    // happen post-0012 but a stale orphan must not crash the page.
    const deployments = (
      await Promise.all(
        rows.map(async (dl) => {
          const service = await ctx.db.getService(dl.service_id);
          if (!service) return null;
          const project = await ctx.db.getProject(service.project_id);
          if (!project) return null;
          return {
            id: dl.id,
            status: dl.status,
            trigger: dl.trigger,
            triggerDetail: dl.trigger_detail,
            commitSha: dl.commit_sha,
            commitMessage: dl.commit_message ?? null,
            durationMs: dl.duration_ms,
            createdAt: normalizeTimestamp(dl.created_at),
            failureSummary: dl.status === 'failed' ? extractFailureSummary(dl.build_log) : null,
            projectId: project.id,
            projectName: project.name,
            serviceId: service.id,
            serviceName: service.name,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    return c.json({ count: deployments.length, deployments });
  });

  return api;
}
