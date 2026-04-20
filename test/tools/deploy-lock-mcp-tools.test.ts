import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function createLockedContext(): AppContext {
  // Day 5 mutation policy: pre-check now consults `archived_at`, `status`,
  // and `db.isCircuitBreakerOpen`. For DEPLOY_LOCKED guard tests the project
  // must remain mutable so the lock contention is what triggers the response.
  const project = { id: 'proj-1', name: 'locked-app', status: 'running', archived_at: null };
  return {
    db: {
      getProjectByName: vi.fn((name: string) => (name === 'locked-app' ? project : undefined)),
      acquireDeployLock: vi.fn(() => false),
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
    const tool = getTool(ctx, 'deploy');

    const result = await tool.execute(
      { repo_url: 'https://github.com/test/app' },
      { target: 'mcp' },
    );

    expectDeployLockedResult(result);
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });

  it('execute_deploy_plan returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const tool = getTool(ctx, 'execute_deploy_plan');

    const result = await tool.execute({ plan_id: 'plan-1' }, { target: 'mcp' });

    expectDeployLockedResult(result);
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });

  it('redeploy_project returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const tool = getTool(ctx, 'redeploy_project');

    const result = await tool.execute({ project_name: 'locked-app' }, { target: 'mcp' });

    expectDeployLockedResult(result);
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('rollback_project returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const tool = getTool(ctx, 'rollback_project');

    const result = await tool.execute({ project_name: 'locked-app' }, { target: 'mcp' });

    expectDeployLockedResult(result);
    expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
  });

  it('deploy_blue_green returns DEPLOY_LOCKED response when project lock is held', async () => {
    const ctx = createLockedContext();
    const tool = getTool(ctx, 'deploy_blue_green');

    const result = await tool.execute({ project_name: 'locked-app' }, { target: 'mcp' });

    expectDeployLockedResult(result);
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('deploy_blue_green does not use deploy queue (fire-and-forget)', async () => {
    const ctx = createLockedContext();

    const tool = getTool(ctx, 'deploy_blue_green');
    await tool.execute({ project_name: 'locked-app' }, { target: 'mcp' });

    expect(ctx.deployQueue.acquire).not.toHaveBeenCalled();
  });
});
