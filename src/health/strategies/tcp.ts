import net from 'node:net';
import type { HealthCheckConfig, ProbeResult } from '../types.js';
import { resolveContainerHost } from '../../pipeline/url-resolver.js';

/**
 * Probe a TCP port to check if it's open and accepting connections.
 * @param config Health check configuration
 * @param port Port number to probe
 * @returns Promise resolving to probe result
 */
export async function tcpProbe(config: HealthCheckConfig, port: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = net.createConnection({ port, host: resolveContainerHost() });

    let resolved = false;

    socket.setTimeout(config.timeoutMs);

    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        const responseTimeMs = Date.now() - startTime;
        socket.destroy();
        resolve({
          healthy: true,
          source: 'tcp',
          responseTimeMs,
        });
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({
          healthy: false,
          source: 'tcp',
          error: 'TCP connection timed out',
        });
      }
    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({
          healthy: false,
          source: 'tcp',
          error: (err as NodeJS.ErrnoException).code || err.message,
        });
      }
    });
  });
}
