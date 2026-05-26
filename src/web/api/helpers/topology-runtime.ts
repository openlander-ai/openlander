import type { AppContext } from '../../../app.js';
import { createModuleLogger } from '../../../lib/logger.js';
import { isManagedServiceKind } from '../../../db/repos/service.repo.js';
import type { ServiceConnectionRow, ServiceRow } from '../../../db/types.js';

const log = createModuleLogger('api:topology-runtime');
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

export interface TopologyNodeRuntime {
  health: 'healthy' | 'crashed' | 'deploying';
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
export const TOPOLOGY_INSPECT_CONCURRENCY = 6;

export async function mapWithConcurrency<T, R>(
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

export interface TopologyNode {
  /** Service id used as the service_metrics lookup key. */
  id: string;
  container_id: string | null;
  status: string | null;
}

const topologyCacheInvalidationRegistered = new WeakSet<object>();

export function registerTopologyCacheInvalidation(ctx: AppContext): void {
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
  // (ServiceHealthMonitor.runServiceCheck) populates this table on a
  // lightweight cadence, so a fresh row is the same CPU/mem projection
  // Docker would give us — minus the per-node 1-2s socket round trip
  // that previously dominated /api/projects topology fan-out.
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
  // Only `unhealthy` collapses to `crashed`. `building` is surfaced
  // as `deploying` so the project list and service topology agree —
  // PR #66 mapped it to `healthy` as a tactical fix; now we widen the
  // vocab to a first-class deploy-in-progress state.
  //
  // Inspect failure collapses to `crashed` for parity with
  // ServiceManager.inspectServiceContainer (which sets status: 'error'
  // on the same failure mode).
  let health: 'healthy' | 'crashed' | 'deploying' = 'healthy';
  if (node.status === 'building') {
    health = 'deploying';
  } else if (node.status !== 'running') {
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
export async function getTopologyNodeRuntime(
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

/** Merge `source` dependsOn edges into `target` (deduped), returning `target`. */
export function mergeDependsOn(
  target: Map<string, string[]>,
  source: Map<string, string[]>,
): Map<string, string[]> {
  for (const [serviceId, deps] of source.entries()) {
    const merged = new Set([...(target.get(serviceId) ?? []), ...deps]);
    target.set(serviceId, [...merged]);
  }
  return target;
}

/**
 * Resolve which managed (database) services are connected to a project's
 * deployable group. Shared by the project- and service-scoped topology
 * endpoints so both derive the managed-node set identically. Returns the raw
 * connection rows too, since the caller needs them to build connection edges.
 */
export async function deriveConnectedManagedServices(
  ctx: Pick<AppContext, 'db'>,
  projectId: string,
  groupServices: readonly ServiceRow[],
): Promise<{ serviceConnections: ServiceConnectionRow[]; connectedManagedServices: ServiceRow[] }> {
  const serviceConnections =
    typeof ctx.db.listServiceConnectionsByProject === 'function'
      ? await ctx.db.listServiceConnectionsByProject(projectId)
      : [];
  const allServices =
    serviceConnections.length > 0 && typeof ctx.db.listServices === 'function'
      ? await ctx.db.listServices()
      : [];
  const servicesById = new Map(allServices.map((service) => [service.id, service]));
  const seen = new Set(groupServices.map((service) => service.id));
  const connectedManagedServices: ServiceRow[] = [];
  for (const connection of serviceConnections) {
    const service = servicesById.get(connection.service_id_provider);
    if (!service || seen.has(service.id) || !isManagedServiceKind(service.kind)) {
      continue;
    }
    seen.add(service.id);
    connectedManagedServices.push(service);
  }
  return { serviceConnections, connectedManagedServices };
}

/**
 * Build dependsOn edges implied by service connections: a consumer depends on
 * its provider, but only when both ends are nodes in the current topology.
 */
export function buildConnectionDependsOn(
  serviceConnections: readonly ServiceConnectionRow[],
  nodeIds: ReadonlySet<string>,
): Map<string, string[]> {
  const connectionDependsOn = new Map<string, string[]>();
  for (const connection of serviceConnections) {
    if (
      !nodeIds.has(connection.service_id_consumer) ||
      !nodeIds.has(connection.service_id_provider)
    ) {
      continue;
    }
    const existing = connectionDependsOn.get(connection.service_id_consumer) ?? [];
    connectionDependsOn.set(connection.service_id_consumer, [
      ...existing,
      connection.service_id_provider,
    ]);
  }
  return connectionDependsOn;
}
