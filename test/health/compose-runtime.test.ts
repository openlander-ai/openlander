import { describe, expect, it } from 'vitest';

import {
  aggregateComposeStatus,
  resolveComposeTrafficTargetId,
  serviceHealthStrategy,
  serviceLifecycle,
} from '../../src/health/compose-runtime.js';

describe('compose runtime semantics', () => {
  it('uses the persisted traffic service when several applications expose ports', () => {
    const children = [
      {
        id: 'stack__web__svc',
        name: 'stack/web__svc',
        runtime_role: 'application' as const,
        assigned_port: 10001,
      },
      {
        id: 'stack__api__svc',
        name: 'stack/api__svc',
        runtime_role: 'application' as const,
        assigned_port: 10002,
      },
    ];

    expect(resolveComposeTrafficTargetId(children, 'web')).toBe('stack__web__svc');
    expect(resolveComposeTrafficTargetId(children)).toBeUndefined();
  });

  it('does not degrade a project for a successfully stopped one-shot job', () => {
    expect(
      aggregateComposeStatus(
        [
          { id: 'web', runtime_role: 'application', status: 'running' },
          { id: 'db', runtime_role: 'resource', status: 'running' },
          { id: 'migrate', runtime_role: 'job', status: 'stopped' },
        ],
        new Map([['migrate', 'success']]),
      ),
    ).toBe('running');
  });

  it('distinguishes degraded long-running services from hard failures', () => {
    expect(
      aggregateComposeStatus([
        { id: 'web', runtime_role: 'application', status: 'stopped' },
        { id: 'db', runtime_role: 'resource', status: 'running' },
      ]),
    ).toBe('degraded');
    expect(
      aggregateComposeStatus([
        { id: 'web', runtime_role: 'application', status: 'running' },
        { id: 'migrate', runtime_role: 'job', status: 'error' },
      ]),
    ).toBe('error');
  });

  it('uses the latest job deploy result to identify a failed stopped job', () => {
    expect(
      aggregateComposeStatus(
        [{ id: 'migrate', runtime_role: 'job', status: 'stopped' }],
        new Map([['migrate', 'failed']]),
      ),
    ).toBe('error');
  });

  it('treats cancelled jobs as errors and missing completion evidence as degraded', () => {
    const children = [
      { id: 'web', runtime_role: 'application' as const, status: 'running' as const },
      { id: 'migrate', runtime_role: 'job' as const, status: 'stopped' as const },
    ];

    expect(aggregateComposeStatus(children, new Map([['migrate', 'cancelled']]))).toBe('error');
    expect(aggregateComposeStatus(children)).toBe('degraded');
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
