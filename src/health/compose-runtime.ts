import type { ServiceRow } from '../db/types.js';

export type ServiceLifecycle = 'long_running' | 'one_shot';
export type ServiceHealthStrategy = 'http' | 'tcp' | 'docker_health' | 'exit_code' | 'none';
export type ComposeAggregateStatus = 'running' | 'degraded' | 'error';

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
  children: ReadonlyArray<Pick<ServiceRow, 'runtime_role' | 'status'>>,
  lastDeployStatus: ReadonlyMap<string, 'success' | 'failed' | 'cancelled'> = new Map(),
  childIds: readonly string[] = [],
): ComposeAggregateStatus | undefined {
  if (children.length === 0) return undefined;

  for (const [index, child] of children.entries()) {
    const childId = childIds[index];
    const lastStatus = childId ? lastDeployStatus.get(childId) : undefined;
    if (child.status === 'error' || (child.runtime_role === 'job' && lastStatus === 'failed')) {
      return 'error';
    }
  }

  const longRunning = children.filter((child) => child.runtime_role !== 'job');
  return longRunning.every((child) => child.status === 'running') ? 'running' : 'degraded';
}
