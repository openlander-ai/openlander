/** MCP service runtime tools must surface typed mutation-policy rejections. */
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../../src/errors.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

interface ProjectFixtureOpts {
  archived?: boolean;
  status?: 'running' | 'recovering' | 'stopped' | 'error' | 'building';
  circuitBreakerOpen?: boolean;
}

function createPolicyContext(opts: ProjectFixtureOpts = {}): AppContext {
  const project = {
    id: 'proj-1',
    name: 'rejected-app',
    status: opts.status ?? 'running',
    archived_at: opts.archived ? '2024-06-01T00:00:00Z' : null,
  };
  const service = {
    id: 'svc-1',
    name: 'rejected-api',
    project_id: project.id,
    kind: 'git',
    source: 'git',
  };
  return {
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
      getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
      getDeployableForProject: vi.fn((id: string) => (id === project.id ? service : undefined)),
      listServices: vi.fn(() => [service]),
      isCircuitBreakerOpen: vi.fn(() => opts.circuitBreakerOpen ?? false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

function expectPolicyRejection(result: unknown, code: string) {
  expect(result).toMatchObject({
    success: false,
    status: 'rejected_by_policy',
    error: code,
    project: 'rejected-app',
  });
}

const serviceArgs = { service_name: 'rejected-api' };

describe('MCP service runtime mutation policy rejections', () => {
  describe('rollback_service', () => {
    it('returns previous-image rollback guidance on success', async () => {
      const ctx = createPolicyContext();
      const result = await getTool(ctx, 'rollback_service').execute(serviceArgs, { target: 'mcp' });
      expect(result).toMatchObject({
        success: true,
        service: { id: 'svc-1', name: 'rejected-api' },
        _agent_guidance: {
          message: expect.stringContaining('stored previous Docker image'),
          next_steps: expect.arrayContaining([
            expect.stringContaining('openlander_monitor.diagnose_service'),
            expect.stringContaining('env vars'),
          ]),
        },
      });
      expect(JSON.stringify(result)).toContain('does not restore databases');
    });

    it('rejects archived project with PROJECT_ARCHIVED', async () => {
      const ctx = createPolicyContext({ archived: true });
      const result = await getTool(ctx, 'rollback_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('rejects recovering project with PROJECT_RECOVERING', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const result = await getTool(ctx, 'rollback_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open with CIRCUIT_BREAKER_OPEN', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const result = await getTool(ctx, 'rollback_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('returns typed rejection when pipeline rejects mid-flight', async () => {
      const ctx = createPolicyContext();
      ctx.pipeline.rollback = vi.fn().mockRejectedValue(new ProjectArchivedError('proj-1')) as never;
      const result = await getTool(ctx, 'rollback_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
    });
  });

  describe('restart_service', () => {
    it('rejects archived project up-front and does NOT stop the project', async () => {
      const ctx = createPolicyContext({ archived: true });
      const result = await getTool(ctx, 'restart_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });

    it('rejects recovering project up-front', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const result = await getTool(ctx, 'restart_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open up-front', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const result = await getTool(ctx, 'restart_service').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
    });
  });

  describe('redeploy_app', () => {
    it('rejects archived project up-front instead of returning fake deploying', async () => {
      const ctx = createPolicyContext({ archived: true });
      const result = await getTool(ctx, 'redeploy_app').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
      expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    });

    it('rejects recovering project up-front', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const result = await getTool(ctx, 'redeploy_app').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open up-front', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const result = await getTool(ctx, 'redeploy_app').execute(serviceArgs, { target: 'mcp' });
      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });
  });

  describe('healthy service regression', () => {
    it('redeploy_app returns deploying for a healthy service', async () => {
      const ctx = createPolicyContext();
      const result = await getTool(ctx, 'redeploy_app').execute(serviceArgs, { target: 'mcp' });
      expect(result).toMatchObject({ status: 'deploying', service: { name: 'rejected-api' } });
    });

    it('restart_service returns restarting for a healthy service', async () => {
      const ctx = createPolicyContext();
      const result = await getTool(ctx, 'restart_service').execute(serviceArgs, { target: 'mcp' });
      expect(result).toMatchObject({ status: 'restarting', service: { name: 'rejected-api' } });
    });
  });

  it('imports typed errors with expected codes', () => {
    expect(new ProjectArchivedError('p').code).toBe('PROJECT_ARCHIVED');
    expect(new ProjectRecoveringError('p').code).toBe('PROJECT_RECOVERING');
    expect(new CircuitBreakerOpenError('p').code).toBe('CIRCUIT_BREAKER_OPEN');
  });
});
