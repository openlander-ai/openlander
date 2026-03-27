/**
 * Environment status aggregation utility
 * Aggregates status from multiple environments with priority ordering
 * Priority: error > building > running > idle > stopped
 */

const STATUS_PRIORITY: Record<string, number> = {
  error: 5,
  building: 4,
  running: 3,
  idle: 2,
  stopped: 1,
};

/**
 * Aggregates the status of multiple environments
 * Returns the status with the highest priority
 * @param environments - Array of environment objects with optional status field
 * @returns The aggregated status string
 */
export function getAggregatedEnvStatus(environments: Array<{ status?: string }>): string {
  if (!environments.length) return 'stopped';

  return environments.reduce((worst, env) => {
    const envStatus = env.status || 'stopped';
    const worstPriority = STATUS_PRIORITY[worst] || 0;
    const envPriority = STATUS_PRIORITY[envStatus] || 0;

    return envPriority > worstPriority ? envStatus : worst;
  }, 'stopped');
}
