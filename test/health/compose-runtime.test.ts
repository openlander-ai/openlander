import { describe, expect, it } from 'vitest';

import {
  aggregateComposeStatus,
  serviceHealthStrategy,
  serviceLifecycle,
} from '../../src/health/compose-runtime.js';

describe('compose runtime semantics', () => {
  it('does not degrade a project for a successfully stopped one-shot job', () => {
    const children = [
      { runtime_role: 'application' as const, status: 'running' as const },
      { runtime_role: 'resource' as const, status: 'running' as const },
      { runtime_role: 'job' as const, status: 'stopped' as const },
    ];

    expect(aggregateComposeStatus(children)).toBe('running');
  });

  it('distinguishes degraded long-running services from hard failures', () => {
    expect(
      aggregateComposeStatus([
        { runtime_role: 'application', status: 'stopped' },
        { runtime_role: 'resource', status: 'running' },
      ]),
    ).toBe('degraded');
    expect(
      aggregateComposeStatus([
        { runtime_role: 'application', status: 'running' },
        { runtime_role: 'job', status: 'error' },
      ]),
    ).toBe('error');
  });

  it('maps roles to lifecycle and diagnostic strategy', () => {
    expect(serviceLifecycle({ runtime_role: 'job' })).toBe('one_shot');
    expect(
      serviceHealthStrategy({
        runtime_role: 'job',
        container_port: null,
        health_check_strategy: 'none',
      }),
    ).toBe('exit_code');
    expect(
      serviceHealthStrategy({
        runtime_role: 'resource',
        container_port: 5432,
        health_check_strategy: 'exec',
      }),
    ).toBe('docker_health');
    expect(
      serviceHealthStrategy({
        runtime_role: 'resource',
        container_port: 5432,
        health_check_strategy: 'tcp',
      }),
    ).toBe('tcp');
    expect(
      serviceHealthStrategy({
        runtime_role: 'application',
        container_port: 3000,
        health_check_strategy: 'http',
      }),
    ).toBe('http');
  });
});
