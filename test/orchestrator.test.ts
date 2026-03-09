import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../src/events/index.js';
import {
  DeployOrchestrator,
  type OrchestrationPipeline,
  type ServiceTopology,
} from '../src/pipeline/orchestrator.js';

describe('DeployOrchestrator', () => {
  it('buildTopology sorts a dependency chain (A -> B -> C)', () => {
    const orchestrator = new DeployOrchestrator(new EventBus());
    const topology = orchestrator.buildTopology(
      [
        { name: 'a', dockerfile: 'a/Dockerfile', dependsOn: [] },
        { name: 'b', dockerfile: 'b/Dockerfile', dependsOn: ['a'] },
        { name: 'c', dockerfile: 'c/Dockerfile', dependsOn: ['b'] },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
      'main',
    );

    expect(topology.executionOrder).toEqual([['a'], ['b'], ['c']]);
  });

  it('buildTopology groups independent services in parallel', () => {
    const orchestrator = new DeployOrchestrator(new EventBus());
    const topology = orchestrator.buildTopology(
      [
        { name: 'a', dockerfile: 'a/Dockerfile', dependsOn: [] },
        { name: 'b', dockerfile: 'b/Dockerfile', dependsOn: [] },
        { name: 'c', dockerfile: 'c/Dockerfile', dependsOn: ['a'] },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
      'main',
    );

    expect(topology.executionOrder[0]).toEqual(['a', 'b']);
    expect(topology.executionOrder[1]).toEqual(['c']);
  });

  it('buildTopology throws on circular dependencies', () => {
    const orchestrator = new DeployOrchestrator(new EventBus());
    expect(() =>
      orchestrator.buildTopology(
        [
          { name: 'a', dockerfile: 'a/Dockerfile', dependsOn: ['c'] },
          { name: 'b', dockerfile: 'b/Dockerfile', dependsOn: ['a'] },
          { name: 'c', dockerfile: 'c/Dockerfile', dependsOn: ['b'] },
        ],
        'https://github.com/example/repo',
        '/tmp/repo',
        'abc123',
      ),
    ).toThrow('Circular dependency detected');
  });

  it('validateTopology detects internal and external port conflicts', () => {
    const orchestrator = new DeployOrchestrator(new EventBus());
    const topology = orchestrator.buildTopology(
      [
        { name: 'api', dockerfile: 'api/Dockerfile', dependsOn: [], port: 3000 },
        { name: 'web', dockerfile: 'web/Dockerfile', dependsOn: [], port: 3000 },
        { name: 'worker', dockerfile: 'worker/Dockerfile', dependsOn: [], port: 5432 },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
    );

    const result = orchestrator.validateTopology(topology, [5432]);

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('Port conflict in topology');
    expect(result.errors.join(' ')).toContain('in-use port 5432');
  });

  it('validateTopology detects missing dependencies', () => {
    const orchestrator = new DeployOrchestrator(new EventBus());
    const topology = {
      services: [{ name: 'api', dockerfile: 'api/Dockerfile', dependsOn: ['db'] }],
      executionOrder: [['api']],
      repoUrl: 'https://github.com/example/repo',
      clonePath: '/tmp/repo',
      commitSha: 'abc123',
    } as ServiceTopology;

    const result = orchestrator.validateTopology(topology);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Missing dependency');
  });

  it('executeOrdered deploys services in dependency order', async () => {
    const events = new EventBus();
    const orchestrator = new DeployOrchestrator(events);
    const topology = orchestrator.buildTopology(
      [
        { name: 'a', dockerfile: 'a/Dockerfile', dependsOn: [] },
        { name: 'b', dockerfile: 'b/Dockerfile', dependsOn: ['a'] },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
    );

    const called: string[] = [];
    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        called.push(service.name);
        return {
          success: true,
          projectId: `${service.name}-id`,
          url: `http://${service.name}.local`,
        };
      },
      rollbackService: async () => {},
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(true);
    expect(called).toEqual(['a', 'b']);
    expect(result.services.map((service) => service.status)).toEqual(['deployed', 'deployed']);
  });

  it('executeOrdered performs atomic rollback when a later service fails', async () => {
    const events = new EventBus();
    const orchestrator = new DeployOrchestrator(events);
    const topology = orchestrator.buildTopology(
      [
        { name: 'a', dockerfile: 'a/Dockerfile', dependsOn: [] },
        { name: 'b', dockerfile: 'b/Dockerfile', dependsOn: ['a'] },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
    );

    const rollbackSpy = vi
      .fn<OrchestrationPipeline['rollbackService']>()
      .mockResolvedValue(undefined);
    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        if (service.name === 'b') {
          return { success: false, error: 'b failed' };
        }
        return { success: true, projectId: 'a-id', url: 'http://a.local' };
      },
      rollbackService: rollbackSpy,
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(false);
    expect(rollbackSpy).toHaveBeenCalledOnce();
    expect(rollbackSpy).toHaveBeenCalledWith({
      name: 'a',
      projectId: 'a-id',
      url: 'http://a.local',
    });
    expect(result.services).toEqual([
      expect.objectContaining({ name: 'a', status: 'rolled_back' }),
      expect.objectContaining({ name: 'b', status: 'failed' }),
    ]);
  });

  it('executeOrdered returns failed result for empty topology', async () => {
    const events = new EventBus();
    const orchestrator = new DeployOrchestrator(events);

    const pipeline: OrchestrationPipeline = {
      deployService: async () => ({ success: true }),
      rollbackService: async () => {},
    };

    const result = await orchestrator.executeOrdered(
      {
        services: [],
        executionOrder: [],
        repoUrl: 'https://github.com/example/repo',
        clonePath: '/tmp/repo',
        commitSha: 'abc123',
      },
      pipeline,
    );

    expect(result.success).toBe(false);
    expect(result.services[0]?.status).toBe('failed');
  });
});
