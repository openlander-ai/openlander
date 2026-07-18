import type { ServiceRow } from '../db/types.js';

export type ServiceLifecycle = 'long_running' | 'one_shot';
export type ServiceHealthStrategy = 'http' | 'tcp' | 'docker_health' | 'exit_code' | 'none';

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
