import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../src/events/index.js';
import {
  DeployOrchestrator,
  type OrchestrationPipeline,
  type ServiceTopology,
} from '../src/pipeline/orchestrator.js';
import { ProjectArchivedError, CircuitBreakerOpenError } from '../src/errors.js';

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

  // ---------------------------------------------------------------------------
  // Day 8 Bug #5: Compose orchestrator must NOT silently swallow rollback
  // exceptions and label services as `rolled_back`. When the pipeline
  // mutation policy rejects the rollback (project archived / recovering /
  // circuit open), the deployment is still live and must be reported as
  // such so operators see the partial state.
  // ---------------------------------------------------------------------------
  it('executeOrdered surfaces rollback_failed_due_to_policy when policy rejects rollback', async () => {
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

    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        if (service.name === 'b') {
          return { success: false, error: 'b failed' };
        }
        return { success: true, projectId: 'a-id', url: 'http://a.local' };
      },
      // Simulate policy rejecting the rollback (archived between deploy
      // and rollback).
      rollbackService: vi
        .fn<OrchestrationPipeline['rollbackService']>()
        .mockRejectedValue(new ProjectArchivedError('a-id')),
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(false);
    const aStatus = result.services.find((s) => s.name === 'a');
    expect(aStatus?.status).toBe('rollback_failed_due_to_policy');
    expect(aStatus?.error).toMatch(/rollback blocked/i);
    expect(aStatus?.error).toMatch(/archived/i);

    const bStatus = result.services.find((s) => s.name === 'b');
    expect(bStatus?.status).toBe('failed');
  });

  it('executeOrdered surfaces rollback_failed_due_to_policy when circuit breaker is open', async () => {
    const events = new EventBus();
    const orchestrator = new DeployOrchestrator(events);
    const topology = orchestrator.buildTopology(
      [
        { name: 'svc1', dockerfile: 'svc1/Dockerfile', dependsOn: [] },
        { name: 'svc2', dockerfile: 'svc2/Dockerfile', dependsOn: ['svc1'] },
      ],
      'https://github.com/example/repo',
      '/tmp/repo',
      'abc123',
    );

    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        if (service.name === 'svc2') {
          return { success: false, error: 'svc2 failed' };
        }
        return { success: true, projectId: 'svc1-id', url: 'http://svc1.local' };
      },
      rollbackService: async () => {
        throw new CircuitBreakerOpenError('svc1-id');
      },
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(false);
    const svc1Status = result.services.find((s) => s.name === 'svc1');
    expect(svc1Status?.status).toBe('rollback_failed_due_to_policy');
    expect(svc1Status?.error).toMatch(/circuit breaker/i);
  });

  // ---------------------------------------------------------------------------
  // Day 9 F2: generic (non-policy) rollback failures must NOT be conflated
  // with policy rejections. Operators need to tell apart "operator-set state
  // (archived/recovering/circuit-open)" from "Docker/generic error".
  // ---------------------------------------------------------------------------
  it('executeOrdered surfaces rollback_failed (not policy) for generic Docker errors', async () => {
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

    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        if (service.name === 'b') {
          return { success: false, error: 'b failed' };
        }
        return { success: true, projectId: 'a-id', url: 'http://a.local' };
      },
      // Generic Docker / runtime error, NOT a policy rejection.
      rollbackService: async () => {
        throw new Error('Docker daemon unreachable');
      },
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(false);
    const aStatus = result.services.find((s) => s.name === 'a');
    expect(aStatus?.status).toBe('rollback_failed');
    expect(aStatus?.status).not.toBe('rollback_failed_due_to_policy');
    expect(aStatus?.error).toMatch(/rollback failed/i);
    expect(aStatus?.error).toMatch(/Docker daemon/i);
  });

  it('executeOrdered still labels services rolled_back when rollback succeeds', async () => {
    // Regression: ensure the new branch did not break the happy path.
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

    const pipeline: OrchestrationPipeline = {
      deployService: async (service) => {
        if (service.name === 'b') {
          return { success: false, error: 'b failed' };
        }
        return { success: true, projectId: 'a-id', url: 'http://a.local' };
      },
      rollbackService: vi.fn<OrchestrationPipeline['rollbackService']>().mockResolvedValue(),
    };

    const result = await orchestrator.executeOrdered(topology, pipeline);

    expect(result.success).toBe(false);
    const aStatus = result.services.find((s) => s.name === 'a');
    expect(aStatus?.status).toBe('rolled_back');
  });
});
