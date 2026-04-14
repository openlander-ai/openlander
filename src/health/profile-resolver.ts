import type { MonitoringProfile, HealthCheckConfig } from './types.js';
import type { ProjectRow } from '../db/types.js';

export function resolveMonitoringProfile(project: ProjectRow): MonitoringProfile {
  const projectType = project.project_type;

  const defaultsByType: Record<
    'web' | 'worker',
    {
      strategy: 'http' | 'none';
      path: string;
      exposeViaTraefik: boolean;
    }
  > = {
    web: {
      strategy: 'http',
      path: '/',
      exposeViaTraefik: true,
    },
    worker: {
      strategy: 'none',
      path: '/',
      exposeViaTraefik: false,
    },
  };

  const defaults = defaultsByType[projectType];

  const strategy = project.health_check_strategy ?? defaults.strategy;

  let path = project.health_check_path ?? defaults.path;
  if (path && !path.startsWith('/')) {
    path = '/' + path;
  }

  const health: HealthCheckConfig = {
    strategy,
    path: strategy === 'http' ? path : undefined,
    timeoutMs: 5000,
    intervalMs: 30000,
    failureThreshold: 3,
    dockerHealthPolicy: 'prefer',
  };

  return {
    projectType,
    exposeViaTraefik: defaults.exposeViaTraefik,
    health,
  };
}
