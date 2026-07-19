import type { ServiceRow } from '../db/types.js';

export type ServiceLifecycle = 'long_running' | 'one_shot';
export type ServiceHealthStrategy = 'http' | 'tcp' | 'docker_health' | 'exit_code' | 'none';
export type ComposeAggregateStatus = 'running' | 'degraded' | 'error';

type ComposeTrafficChild = Pick<ServiceRow, 'id' | 'name' | 'runtime_role' | 'assigned_port'>;

function composeChildServiceName(service: Pick<ServiceRow, 'name'>): string {
  return (
    service.name
      .replace(/__svc$/, '')
      .split('/')
      .at(-1) ?? service.name
  );
}

/**
 * Replace each Compose parent with its persisted runtime children while
 * preserving non-Compose deployables in the same Project. Callers should load
 * all children in one batch and pass them here rather than querying per parent.
 */
export function expandComposeRuntimeServices<
  T extends Pick<ServiceRow, 'id' | 'kind' | 'parent_service_id'>,
>(deployables: readonly T[], composeChildren: readonly T[]): T[] {
  const childrenByParent = new Map<string, T[]>();
  for (const child of composeChildren) {
    if (!child.parent_service_id) continue;
    const siblings = childrenByParent.get(child.parent_service_id) ?? [];
    siblings.push(child);
    childrenByParent.set(child.parent_service_id, siblings);
  }

  const expanded: T[] = [];
  const seen = new Set<string>();
  for (const service of deployables) {
    const children = service.kind === 'compose' ? childrenByParent.get(service.id) : undefined;
    const candidates = children && children.length > 0 ? children : [service];
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      expanded.push(candidate);
    }
  }
  return expanded;
}

/** Only application runtimes may receive HTTP URLs or Traefik routes. */
export function isHttpRoutableRuntimeService(service: {
  runtime_role?: ServiceRow['runtime_role'] | null;
}): boolean {
  return service.runtime_role == null || service.runtime_role === 'application';
}

export function isSuccessfulComposeJob(
  service: Pick<ServiceRow, 'runtime_role' | 'status'>,
  lastDeployStatus?: 'success' | 'failed' | 'cancelled',
): boolean {
  return (
    service.runtime_role === 'job' && service.status === 'stopped' && lastDeployStatus === 'success'
  );
}

export function resolveComposeTrafficTargetId(
  children: readonly ComposeTrafficChild[],
  trafficService?: string,
): string | undefined {
  if (trafficService) {
    return children.find((child) => composeChildServiceName(child) === trafficService)?.id;
  }

  const candidates = children.filter(
    (child) => child.runtime_role === 'application' && child.assigned_port != null,
  );
  return candidates.length === 1 ? candidates[0]?.id : undefined;
}

export function serviceLifecycle(service: Pick<ServiceRow, 'runtime_role'>): ServiceLifecycle {
  return service.runtime_role === 'job' ? 'one_shot' : 'long_running';
}

export function serviceHealthStrategy(
  service: Pick<ServiceRow, 'runtime_role' | 'container_port' | 'health_check_strategy'>,
): ServiceHealthStrategy {
  if (service.runtime_role === 'job') return 'exit_code';
  if (service.runtime_role === 'resource') {
    if (service.health_check_strategy === 'exec') return 'docker_health';
    return service.container_port == null ? 'none' : 'tcp';
  }
  return service.container_port == null ? 'none' : 'http';
}

export function aggregateComposeStatus(
  children: ReadonlyArray<Pick<ServiceRow, 'id' | 'runtime_role' | 'status'>>,
  lastDeployStatus: ReadonlyMap<string, 'success' | 'failed' | 'cancelled'> = new Map(),
): ComposeAggregateStatus | undefined {
  if (children.length === 0) return undefined;

  if (children.some((child) => child.status === 'error')) {
    return 'error';
  }

  const jobs = children.filter((child) => child.runtime_role === 'job');
  if (jobs.some((job) => ['failed', 'cancelled'].includes(lastDeployStatus.get(job.id) ?? ''))) {
    return 'error';
  }

  const longRunning = children.filter((child) => child.runtime_role !== 'job');
  const longRunningHealthy = longRunning.every((child) => child.status === 'running');
  const jobsCompleted = jobs.every(
    (job) => job.status === 'stopped' && lastDeployStatus.get(job.id) === 'success',
  );
  return longRunningHealthy && jobsCompleted ? 'running' : 'degraded';
}
