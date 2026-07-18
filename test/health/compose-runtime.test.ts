import { describe, expect, it } from 'vitest';

import {
  serviceHealthStrategy,
  serviceLifecycle,
} from '../../src/health/compose-runtime.js';

describe('compose runtime semantics', () => {
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
