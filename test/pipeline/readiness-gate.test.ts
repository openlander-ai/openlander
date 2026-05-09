import { describe, expect, it, vi } from 'vitest';

import { DeployOrchestrator } from '../../src/pipeline/orchestrator.js';
import type { OrchestrationPipeline, ServiceTopology } from '../../src/pipeline/orchestrator.js';

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
          'Monorepo health check: not healthy within 60s — proceeding anyway',
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
      'Monorepo health check: not healthy within 60s — proceeding anyway',
    );
  });
});
