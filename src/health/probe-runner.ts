import type { RuntimeBackend } from '../pipeline/runtime/index.js';
import { execProbe } from './strategies/exec.js';
import { httpProbe } from './strategies/http.js';
import { tcpProbe } from './strategies/tcp.js';
import type { HealthCheckConfig, ProbeContext, ProbeResult, ProbeRunner } from './types.js';

const RETRY_DELAY_MS = 200;

type RuntimeInspectState = Awaited<ReturnType<RuntimeBackend['inspectContainer']>>['State'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function needsPort(strategy: HealthCheckConfig['strategy']): strategy is 'http' | 'tcp' {
  return strategy === 'http' || strategy === 'tcp';
}

function isValidProbePort(port: number | undefined): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535;
}

function containerStateProbeResult(state: RuntimeInspectState): ProbeResult {
  if (state.Restarting) {
    return {
      healthy: false,
      source: 'docker',
      error: `Container is restarting (exit code: ${String(state.ExitCode)})`,
    };
  }

  if (state.Running) {
    return { healthy: true, source: 'docker' };
  }

  return {
    healthy: false,
    source: 'docker',
    error: 'Container is not running',
  };
}

export class LocalProbeRunner implements ProbeRunner {
  constructor(private readonly runtime: RuntimeBackend) {}

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
    let inspectedState: RuntimeInspectState | undefined;

    if (config.dockerHealthPolicy === 'prefer' && context.containerId) {
      const info = await this.runtime.inspectContainer(context.containerId);
      inspectedState = info.State;

      const stateResult = containerStateProbeResult(inspectedState);
      if (!stateResult.healthy) {
        return stateResult;
      }

      if (inspectedState.Health) {
        const status = inspectedState.Health.Status;

        return {
          healthy: status === 'healthy',
          source: 'docker',
          error: status !== 'healthy' ? `Docker health status: ${status}` : undefined,
        };
      }
    }

    const port = config.port ?? context.assignedPort;
    if (needsPort(config.strategy)) {
      if (!isValidProbePort(port)) {
        return this.portlessProbeResult(config.strategy, inspectedState);
      }
      return config.strategy === 'http' ? httpProbe(config, port) : tcpProbe(config, port);
    }

    switch (config.strategy) {
      case 'exec':
        return execProbe(context.containerId, config, this.runtime);
      case 'none':
        return { healthy: true, source: 'none' };
    }
  }

  private portlessProbeResult(
    strategy: 'http' | 'tcp',
    inspectedState: RuntimeInspectState | undefined,
  ): ProbeResult {
    if (inspectedState) {
      return containerStateProbeResult(inspectedState);
    }

    return {
      healthy: false,
      source: strategy,
      error: `No assigned port available for ${strategy.toUpperCase()} health probe`,
    };
  }
}

export function createLocalProbeRunner(runtime: RuntimeBackend): LocalProbeRunner {
  return new LocalProbeRunner(runtime);
}
