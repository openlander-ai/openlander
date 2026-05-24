import type { RuntimeBackend } from '../../pipeline/runtime/index.js';
import type { HealthCheckConfig, ProbeResult } from '../types.js';

/**
 * Execute a command inside a container to check its health.
 * @param containerId Container ID to probe
 * @param config Health check configuration
 * @param runtime Runtime backend
 * @returns Promise resolving to probe result
 */
export async function execProbe(
  containerId: string,
  config: HealthCheckConfig,
  runtime: RuntimeBackend,
): Promise<ProbeResult> {
  // Skip if no command is configured
  if (!config.command || config.command.length === 0) {
    return {
      healthy: true,
      source: 'none',
    };
  }

  const startTime = Date.now();

  try {
    const result = await runtime.execSimple(containerId, config.command);
    const responseTimeMs = Date.now() - startTime;

    if (result.exitCode === 0) {
      return {
        healthy: true,
        source: 'exec',
        responseTimeMs,
      };
    }

    return {
      healthy: false,
      source: 'exec',
      error: `exec probe failed with exit code ${String(result.exitCode)}`,
    };
  } catch (err) {
    return {
      healthy: false,
      source: 'exec',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
