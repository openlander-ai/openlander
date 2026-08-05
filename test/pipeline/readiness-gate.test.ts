import { describe, expect, it, vi } from 'vitest';

import { DeployOrchestrator } from '../../src/pipeline/orchestrator.js';
import type { OrchestrationPipeline, ServiceTopology } from '../../src/pipeline/orchestrator.js';
import {
  extractRuntimeLogFromDeployError,
  runAndVerify,
  type DeployOrchestrationDeps,
} from '../../src/pipeline/deploy/orchestrator.js';
import { ContainerOps } from '../../src/pipeline/docker/container.js';
import type { DockerContext } from '../../src/pipeline/docker/context.js';

describe('Monorepo readiness gate (executeOrdered)', () => {
  const buildTopology = (services: { name: string; dependsOn: string[] }[]): ServiceTopology => {
    const orchestrator = new DeployOrchestrator();
    return orchestrator.buildTopology(
      services.map((service) => ({
        ...service,
        dockerfile: `${service.name}/Dockerfile`,
      })),
      'https://github.com/test/mono',
      '/tmp/clone',
      'abc1234',
    );
  };

  it('waitForHealthy called after api deploys, before worker deploys', async () => {
    const callOrder: string[] = [];
    const topology = buildTopology([
      { name: 'api', dependsOn: [] },
      { name: 'worker', dependsOn: ['api'] },
    ]);

    const pipeline: OrchestrationPipeline = {
      deployService: vi.fn().mockImplementation(async (service) => {
        callOrder.push(`deploy:${service.name}`);
        return { success: true, projectId: `id-${service.name}` };
      }),
      rollbackService: vi.fn().mockResolvedValue(undefined),
      waitForHealthy: vi.fn().mockImplementation(async (service) => {
        callOrder.push(`health:${service.name}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { healthy: true };
      }),
    };

    const orchestrator = new DeployOrchestrator();
    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(true);

    const apiDeployIdx = callOrder.indexOf('deploy:api');
    const apiHealthIdx = callOrder.indexOf('health:api');
    const workerDeployIdx = callOrder.indexOf('deploy:worker');
    expect(apiDeployIdx).toBeLessThan(apiHealthIdx);
    expect(apiHealthIdx).toBeLessThan(workerDeployIdx);
  });

  it('health check timeout logs warning and deploy proceeds', async () => {
    const topology = buildTopology([
      { name: 'api', dependsOn: [] },
      { name: 'worker', dependsOn: ['api'] },
    ]);

    const deployedServices: string[] = [];
    const warn = vi.fn();

    const pipeline: OrchestrationPipeline = {
      deployService: vi.fn().mockImplementation(async (service) => {
        deployedServices.push(service.name);
        return { success: true, projectId: `id-${service.name}` };
      }),
      rollbackService: vi.fn().mockResolvedValue(undefined),
      waitForHealthy: vi.fn().mockImplementation(async (service) => {
        warn(
          { serviceName: service.name, error: 'timeout' },
          'Monorepo health check: not healthy within readiness window — proceeding anyway',
        );
        return { healthy: true };
      }),
    };

    const orchestrator = new DeployOrchestrator();
    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(true);
    expect(deployedServices).toContain('api');
    expect(deployedServices).toContain('worker');
    expect(warn).toHaveBeenCalledWith(
      { serviceName: 'api', error: 'timeout' },
      'Monorepo health check: not healthy within readiness window — proceeding anyway',
    );
  });
});

describe('Docker readiness wait', () => {
  it('extends the wait deadline to honor Docker HEALTHCHECK start_period', async () => {
    vi.useFakeTimers();
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    vi.setSystemTime(startedAt);
    const startingResponse = {
      Config: { Healthcheck: { StartPeriod: 3_000_000_000 } },
      State: {
        Running: true,
        Restarting: false,
        ExitCode: 0,
        StartedAt: startedAt.toISOString(),
        Health: { Status: 'starting' },
      },
    };
    const healthyResponse = {
      Config: { Healthcheck: { StartPeriod: 3_000_000_000 } },
      State: {
        Running: true,
        Restarting: false,
        ExitCode: 0,
        StartedAt: startedAt.toISOString(),
        Health: { Status: 'healthy' },
      },
    };
    const inspectResponses = [
      startingResponse,
      startingResponse,
      startingResponse,
      startingResponse,
      startingResponse,
      startingResponse,
      startingResponse,
      healthyResponse,
    ];
    const inspect = vi.fn(async () => inspectResponses.shift() ?? healthyResponse);
    const ops = new ContainerOps(
      {
        client: {
          getContainer: vi.fn(() => ({ inspect })),
        },
      } as unknown as DockerContext,
      {
        ensureSharedNetworkAttachment: vi.fn(),
        connectToNetworkStrict: vi.fn(),
      },
    );

    const result = ops.waitForHealthy('container-with-start-period', 1000);
    await vi.advanceTimersByTimeAsync(3500);

    await expect(result).resolves.toEqual({ healthy: true });
    expect(inspect).toHaveBeenCalledTimes(8);
  });
});

describe('Deploy runtime log capture', () => {
  it('captures full container logs on startup health failure', async () => {
    const runtimeLog = Array.from(
      { length: 100 },
      (_, index) => `runtime ${String(index + 1)}`,
    ).join('\n');
    const runtime = {
      waitForHealthy: vi.fn().mockResolvedValue({ healthy: false, error: 'migration failed' }),
      getLogs: vi.fn().mockResolvedValue(runtimeLog),
    };
    const deps = {
      runtime,
      db: {
        updateEnvironment: vi.fn().mockResolvedValue(undefined),
      },
      env: {
        getGlobalSecrets: vi.fn().mockResolvedValue({}),
        getAll: vi.fn().mockResolvedValue({}),
        getAllWithInheritance: vi.fn().mockResolvedValue({}),
        getAllForService: vi.fn().mockResolvedValue({}),
        getSecretFilesForDeploy: vi.fn().mockResolvedValue([]),
      },
      stateManager: {
        transition: vi.fn().mockResolvedValue(true),
      },
      containerRunner: {
        run: vi.fn().mockResolvedValue({
          containerId: 'container-runtime-crash',
          port: 12345,
          url: 'http://localhost:12345',
        }),
      },
      jobManager: {
        updatePhase: vi.fn(),
      },
      buildExecutor: {},
      applyPendingFix: vi.fn(),
      secretScanEnabled: false,
    } as unknown as DeployOrchestrationDeps;

    let thrown: unknown;
    try {
      await runAndVerify(deps, {
        projectId: 'project-1',
        environmentId: 'env-1',
        projectName: 'crashy',
        routeName: 'crashy',
        environmentType: 'production',
        imageTag: 'openlander/crashy:latest',
        previousEnvironmentImageTag: null,
        previousProjectImageTag: null,
        shouldSyncProjectState: false,
        config: {},
        buildLog: '[build] ok\n',
      });
    } catch (error) {
      thrown = error;
    }

    expect(runtime.getLogs).toHaveBeenCalledWith('container-runtime-crash', 'all');
    expect(runtime.waitForHealthy).toHaveBeenCalledWith('container-runtime-crash', 20000);
    expect(extractRuntimeLogFromDeployError(thrown)).toBe(runtimeLog);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('Container logs (last 80 lines)');
    expect((thrown as Error).message).toContain('runtime 21');
    expect((thrown as Error).message).not.toContain('runtime 20');
  });
});
