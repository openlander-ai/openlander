import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function createLockedContext(): AppContext {
  const project = { id: 'proj-1', name: 'locked-app', status: 'running', archived_at: null };
  const service = {
    id: 'svc-1',
    name: 'locked-api',
    project_id: project.id,
    kind: 'git',
    source: 'git',
  };
  return {
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn((name: string) => (name === 'locked-app' ? project : undefined)),
      getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
      getDeployableForProject: vi.fn((id: string) => (id === project.id ? service : undefined)),
      listServices: vi.fn(() => [service]),
      acquireDeployLock: vi.fn(() => false),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      isCircuitBreakerOpen: vi.fn(() => false),
      getDeployLockInfo: vi.fn(() => ({
        session: 'other-session',
        lockedAt: new Date().toISOString(),
      })),
      getDeployPlan: vi.fn((planId: string) => ({
        id: planId,
        plan_json: JSON.stringify({
          plan_id: planId,
          project_id: 'proj-1',
          app: { name: 'locked-app' },
        }),
      })),
    },
    planEngine: {
      createPlan: vi.fn(async () => ({
        plan_id: 'plan-1',
        status: 'ready',
        app: { name: 'locked-app' },
        project_id: 'proj-1',
        missing: [],
        warnings: [],
      })),
      executePlan: vi.fn(),
    },
    pipeline: {
      redeploy: vi.fn(),
      rollback: vi.fn(),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;
}

function createMemoryLockedContext(): AppContext {
  const project = { id: 'proj-1', name: 'locked-app', status: 'running', archived_at: null };
  const service = {
    id: 'svc-1',
    name: 'locked-api',
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
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      isCircuitBreakerOpen: vi.fn(() => false),
      getDeployLockInfo: vi.fn(() => null),
    },
    agentPool: {
      acquireProjectLock: vi.fn(() => false),
      getProjectLock: vi.fn(() => ({ sessionId: 'memory-session' })),
      releaseProjectLock: vi.fn(),
    },
    pipeline: {
      redeploy: vi.fn(),
      rollback: vi.fn(),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;
}

function expectDeployLockedResult(result: unknown) {
  expect(result).toMatchObject({
    success: false,
    error: 'DEPLOY_LOCKED',
    _agent_guidance: {
      message: 'Another deploy is in progress for this project.',
      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
    },
  });
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('BUG-002 MCP deploy tool lock guard', () => {
  it('deploy returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const result = await getTool(ctx, 'deploy_app').execute(
      { repo_url: 'https://github.com/test/app' },
      { target: 'mcp' },
    );
    expectDeployLockedResult(result);
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });

  it('execute_deploy_plan returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const result = await getTool(ctx, 'execute_deploy_plan').execute(
      { plan_id: 'plan-1' },
      { target: 'mcp' },
    );
    expectDeployLockedResult(result);
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });

  it('redeploy_app returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'locked-api' },
      { target: 'mcp' },
    );
    expectDeployLockedResult(result);
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('rollback_service returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const result = await getTool(ctx, 'rollback_service').execute(
      { service_name: 'locked-api' },
      { target: 'mcp' },
    );
    expectDeployLockedResult(result);
    expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
  });

  it('rollback_service releases DB deploy lock when memory lock is held', async () => {
    const ctx = createMemoryLockedContext();
    const result = await getTool(ctx, 'rollback_service').execute(
      { service_name: 'locked-api' },
      { target: 'mcp' },
    );
    expectDeployLockedResult(result);
    expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    expect(ctx.db.releaseDeployLock).toHaveBeenCalledWith(
      'proj-1',
      expect.stringMatching(/^mcp-rollback-service-/),
    );
  });
});
