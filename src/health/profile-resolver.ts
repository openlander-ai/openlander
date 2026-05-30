import type { MonitoringProfile, HealthCheckConfig } from './types.js';
import type { ProjectRow, ServiceRow } from '../db/types.js';
import { serviceViewFromRows } from '../db/views/service-view.js';

export function resolveMonitoringProfile(
  project: ProjectRow,
  deployable?: ServiceRow | null,
): MonitoringProfile {
  const view = serviceViewFromRows(project, deployable);
  const projectType = view.projectType ?? 'web';

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

  const strategy = view.healthCheckStrategy ?? defaults.strategy;

  let path = view.healthCheckPath ?? defaults.path;
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
