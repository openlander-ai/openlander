import type { Docker } from '../pipeline/docker.js';
import { execProbe } from './strategies/exec.js';
import { httpProbe } from './strategies/http.js';
import { tcpProbe } from './strategies/tcp.js';
import type { HealthCheckConfig, ProbeContext, ProbeResult, ProbeRunner } from './types.js';

const RETRY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class LocalProbeRunner implements ProbeRunner {
  constructor(private readonly docker: Docker) {}

  async runProbe(config: HealthCheckConfig, context: ProbeContext): Promise<ProbeResult> {
    const attempts = Math.max(config.failureThreshold, 1);
    let lastResult: ProbeResult = { healthy: false, source: 'none' };

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      lastResult = await this.runSingleProbe(config, context);

      if (lastResult.healthy) {
        return lastResult;
      }

      if (attempt < attempts - 1) {
        await sleep(RETRY_DELAY_MS);
      }
    }

    return lastResult;
  }

  private async runSingleProbe(
    config: HealthCheckConfig,
    context: ProbeContext,
  ): Promise<ProbeResult> {
    if (config.dockerHealthPolicy === 'prefer' && context.containerId) {
      const info = await this.docker.inspectContainer(context.containerId);

      if (info.State.Health) {
        const status = info.State.Health.Status;

        return {
          healthy: status === 'healthy',
          source: 'docker',
          error: status !== 'healthy' ? `Docker health status: ${status}` : undefined,
        };
      }
    }

    const port = config.port ?? context.assignedPort ?? 0;

    switch (config.strategy) {
      case 'http':
        return httpProbe(config, port);
      case 'tcp':
        return tcpProbe(config, port);
      case 'exec':
        return execProbe(context.containerId, config, this.docker);
      case 'none':
        return { healthy: true, source: 'none' };
    }
  }
}

export function createLocalProbeRunner(docker: Docker): LocalProbeRunner {
  return new LocalProbeRunner(docker);
}
