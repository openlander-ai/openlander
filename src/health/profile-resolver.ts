import type { MonitoringProfile, HealthCheckConfig } from './types.js';
import type { ProjectRow, ServiceRow } from '../db/types.js';

export function resolveMonitoringProfile(
  project: ProjectRow,
  deployable?: ServiceRow | null,
): MonitoringProfile {
  // PR 4.5: canonical-first reads — deployable (services) is source of truth post-0012.
  const projectType = deployable?.project_type ?? project.project_type ?? 'web';

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

  const strategy =
    deployable?.health_check_strategy ?? project.health_check_strategy ?? defaults.strategy;

  let path = deployable?.health_check_path ?? project.health_check_path ?? defaults.path;
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
