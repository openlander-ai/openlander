import type { AppContext } from '../../../app.js';
import type { ProjectRow } from '../../../db/types.js';
import { loadServiceView, type ServiceView } from '../../../db/views/service-view.js';
import { createModuleLogger } from '../../../lib/logger.js';
import { computeContainerCpuPercent, type ContainerStatsRaw } from '../../../pipeline/docker.js';

const log = createModuleLogger('api:service-runtime-stats');

/**
 * Shape returned by `/projects/:id/stats` (project-compat) and
 * `/projects/:p/services/:s/stats` (service-aux). Both routes returned this
 * exact object inline until R2 — kept here as the public contract for any
 * future caller that wants the same numbers without re-implementing the
 * deployable + project fallback chain.
 */
export interface ProjectRuntimeStats {
  cpu: number;
  memory: number;
  memoryLimit: number;
  status: string | null;
}

/**
 * Translate `ServiceView.status` back to the legacy `string | null` that
 * this endpoint historically emitted. The view normalizes the
 * "neither row had a status" case to `'idle'`; the pre-v0.2 helper
 * emitted `null` for that case and never produced `'idle'` directly.
 * Mapping is therefore lossless on this endpoint.
 *
 * (Other helpers that historically emitted `'idle'` keep view.status as-is.)
 */
function statusForRuntimeStats(view: ServiceView): string | null {
  return view.status === 'idle' ? null : view.status;
}

/**
 * Resolve the runtime stats projection for a single project / deployable.
 * Behavior pinned to the pre-R2 inline blocks:
 *
 * - Status and container_id fall back deployable → project → null
 *   (now sourced from `ServiceView`; see `statusForRuntimeStats`).
 * - Stats are queried only when the container is `running` AND a
 *   container_id resolves; otherwise zeroed stats are returned with the
 *   resolved status so the caller can still surface "stopped" / "building"
 *   / etc. to the client.
 * - Docker stats failure collapses to zeroed stats with the same resolved
 *   status (the original try/catch / `.catch` behavior in both routes) and
 *   is logged at debug level — previously only project-compat logged, but
 *   that's a strict superset of service-aux's silent-catch behavior and
 *   the new channel `api:service-runtime-stats` is filterable.
 * - CPU% formula stays the shared `computeContainerCpuPercent` helper from
 *   #199; per-caller cpuCount fallback resolution (`percpu_usage.length`
 *   then `online_cpus` then 1) is preserved.
 *
 * v0.2 service-first read model, slice S0: this helper is the proof-of-
 * shape consumer of `ServiceView`. Behavior is byte-identical to the
 * pre-S0 implementation (integration tests pin the contract).
 */
export async function loadProjectRuntimeStats(
  ctx: Pick<AppContext, 'db' | 'docker'>,
  project: ProjectRow,
): Promise<ProjectRuntimeStats> {
  const view = await loadServiceView(ctx.db, project);
  const status = statusForRuntimeStats(view);
  const { containerId } = view;
  if (!containerId || view.status !== 'running') {
    return { cpu: 0, memory: 0, memoryLimit: 0, status };
  }
  try {
    const stats = (await ctx.docker.getContainerStats(containerId)) as ContainerStatsRaw;
    const cpuCountRaw = stats.cpu_stats.cpu_usage.percpu_usage?.length;
    const cpuCount =
      cpuCountRaw && cpuCountRaw > 0 ? cpuCountRaw : stats.cpu_stats.online_cpus || 1;
    const cpuPercent = computeContainerCpuPercent(stats, cpuCount);
    return {
      cpu: Math.round(cpuPercent * 10) / 10,
      memory: stats.memory_stats.usage,
      memoryLimit: stats.memory_stats.limit,
      status,
    };
  } catch (err) {
    log.debug({ err, projectId: project.id }, 'Container stats fetch failed');
    return { cpu: 0, memory: 0, memoryLimit: 0, status };
  }
}
