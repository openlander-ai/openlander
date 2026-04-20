/**
 * Day 5 HIGH-B regression tests: MCP tools must surface a typed mutation
 * policy rejection (archived / recovering / circuit-open) instead of a fake
 * "deploying" success.
 *
 * The previous test surface only covered DeployLockedError; ProjectArchivedError,
 * ProjectRecoveringError, and CircuitBreakerOpenError were silently swallowed
 * in fire-and-forget tools and bubbled as plain failures in await-style tools.
 */
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
  return {
    db: {
      getProjectByName: vi.fn((name: string) => (name === 'rejected-app' ? project : undefined)),
      getProject: vi.fn(() => project),
      isCircuitBreakerOpen: vi.fn(() => opts.circuitBreakerOpen ?? false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn(),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      // Resolve to undefined so fire-and-forget `.catch()` chains work in
      // healthy-path regression tests; rejection tests override this with
      // mockRejectedValue.
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

describe('Day 5 HIGH-B — tool mutation policy rejections', () => {
  // -------------------------------------------------------------------------
  // rollback_project — await-style tool. Was already wired for DEPLOY_LOCKED
  // but treated typed policy errors as plain throws.
  // -------------------------------------------------------------------------
  describe('rollback_project', () => {
    it('rejects archived project with PROJECT_ARCHIVED (no fake success)', async () => {
      const ctx = createPolicyContext({ archived: true });
      const tool = getTool(ctx, 'rollback_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('rejects recovering project with PROJECT_RECOVERING', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const tool = getTool(ctx, 'rollback_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open with CIRCUIT_BREAKER_OPEN', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const tool = getTool(ctx, 'rollback_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.rollback).not.toHaveBeenCalled();
    });

    it('returns typed rejection when pipeline rejects mid-flight (race window)', async () => {
      const ctx = createPolicyContext();
      ctx.pipeline.rollback = vi
        .fn()
        .mockRejectedValue(new ProjectArchivedError('proj-1')) as never;
      const tool = getTool(ctx, 'rollback_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
    });
  });

  // -------------------------------------------------------------------------
  // deploy_blue_green — fire-and-forget. Pre-fix would return
  // { status: 'deploying' } even when the project was archived.
  // -------------------------------------------------------------------------
  describe('deploy_blue_green', () => {
    it('rejects archived project up-front instead of returning fake "deploying"', async () => {
      const ctx = createPolicyContext({ archived: true });
      const tool = getTool(ctx, 'deploy_blue_green');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
      expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    });

    it('rejects recovering project up-front', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const tool = getTool(ctx, 'deploy_blue_green');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open up-front', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const tool = getTool(ctx, 'deploy_blue_green');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // restart_project — fire-and-forget. Pre-fix would stop the project AND
  // return a fake "restarting" success even when the pipeline would reject.
  // -------------------------------------------------------------------------
  describe('restart_project', () => {
    it('rejects archived project up-front and does NOT stop the project', async () => {
      const ctx = createPolicyContext({ archived: true });
      const tool = getTool(ctx, 'restart_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });

    it('rejects recovering project up-front', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const tool = getTool(ctx, 'restart_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open up-front', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const tool = getTool(ctx, 'restart_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.stop).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // redeploy_project — fire-and-forget. Pre-fix would return
  // { status: 'redeploying' } even when the project was archived.
  // -------------------------------------------------------------------------
  describe('redeploy_project', () => {
    it('rejects archived project up-front instead of returning fake "redeploying"', async () => {
      const ctx = createPolicyContext({ archived: true });
      const tool = getTool(ctx, 'redeploy_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_ARCHIVED');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
      expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    });

    it('rejects recovering project up-front', async () => {
      const ctx = createPolicyContext({ status: 'recovering' });
      const tool = getTool(ctx, 'redeploy_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'PROJECT_RECOVERING');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });

    it('rejects circuit-breaker open up-front', async () => {
      const ctx = createPolicyContext({ circuitBreakerOpen: true });
      const tool = getTool(ctx, 'redeploy_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expectPolicyRejection(result, 'CIRCUIT_BREAKER_OPEN');
      expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Sanity: healthy project still proceeds normally (no false-positive guard).
  // -------------------------------------------------------------------------
  describe('healthy project regression', () => {
    it('redeploy_project still returns "redeploying" for a healthy project', async () => {
      const ctx = createPolicyContext();
      const tool = getTool(ctx, 'redeploy_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expect(result).toMatchObject({ status: 'redeploying', project: 'rejected-app' });
    });

    it('restart_project still returns "restarting" for a healthy project', async () => {
      const ctx = createPolicyContext();
      const tool = getTool(ctx, 'restart_project');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expect(result).toMatchObject({ status: 'restarting', project: 'rejected-app' });
      expect(ctx.pipeline.stop).toHaveBeenCalled();
    });

    it('deploy_blue_green still returns "deploying" for a healthy project', async () => {
      const ctx = createPolicyContext();
      const tool = getTool(ctx, 'deploy_blue_green');

      const result = await tool.execute({ project_name: 'rejected-app' }, { target: 'mcp' });

      expect(result).toMatchObject({ status: 'deploying', strategy: 'blue-green' });
    });
  });

  // Re-export typed errors usage check (avoid unused-import warnings for the
  // imports above when the strict lint runs). They double as a sanity assertion
  // that the constructor signatures haven't changed.
  it('imports typed errors with expected codes', () => {
    expect(new ProjectArchivedError('p').code).toBe('PROJECT_ARCHIVED');
    expect(new ProjectRecoveringError('p').code).toBe('PROJECT_RECOVERING');
    expect(new CircuitBreakerOpenError('p').code).toBe('CIRCUIT_BREAKER_OPEN');
  });
});
