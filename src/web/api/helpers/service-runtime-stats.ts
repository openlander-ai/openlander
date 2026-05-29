import type { AppContext } from '../../../app.js';
import type { ProjectRow } from '../../../db/types.js';
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
 * Resolve the runtime stats projection for a single project / deployable.
 * Behavior pinned to the pre-R2 inline blocks:
 *
 * - Status and container_id fall back deployable → project → null.
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
 */
export async function loadProjectRuntimeStats(
  ctx: Pick<AppContext, 'db' | 'docker'>,
  project: ProjectRow,
): Promise<ProjectRuntimeStats> {
  const deployable = await ctx.db.getDeployableForProject(project.id);
  const status = deployable?.status ?? project.status ?? null;
  const containerId = deployable?.container_id ?? project.container_id ?? null;
  if (!containerId || status !== 'running') {
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
