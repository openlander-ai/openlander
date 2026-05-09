import type { HealthCheckConfig, ProbeResult } from '../types.js';
import { resolveContainerUrl } from '../../pipeline/url-resolver.js';

export async function httpProbe(config: HealthCheckConfig, port: number): Promise<ProbeResult> {
  const path = config.path ?? '/';
  const url = `${resolveContainerUrl(port)}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  try {
    const start = Date.now();
    const response = await fetch(url, { signal: controller.signal });
    const elapsed = Date.now() - start;

    if (response.ok) {
      return {
        healthy: true,
        source: 'http',
        responseTimeMs: elapsed,
      };
    }

    return {
      healthy: false,
      source: 'http',
      error: `HTTP ${String(response.status)}`,
      responseTimeMs: elapsed,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      healthy: false,
      source: 'http',
      error: errorMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}
