import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppContext } from '../src/app.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

function createMockContext(): AppContext {
  return {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    db: {
      getProjectByName: vi.fn(),
    },
    pipeline: {
      startDeploy: vi.fn(),
    },
    planEngine: {
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      executePlan: vi.fn(),
    },
  } as unknown as AppContext;
}

describe('deploy-plan integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deploy_project and redeploy_project are NOT in tool registry', () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const toolNames = registry.map((tool) => tool.name);

    expect(toolNames).not.toContain('deploy_project');
    expect(toolNames).not.toContain('redeploy_project');
  });

  it('create_deploy_plan, update_deploy_plan, execute_deploy_plan ARE in tool registry', () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const toolNames = registry.map((tool) => tool.name);

    expect(toolNames).toContain('create_deploy_plan');
    expect(toolNames).toContain('update_deploy_plan');
    expect(toolNames).toContain('execute_deploy_plan');
  });

  it('create_deploy_plan calls planEngine.createPlan', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((t) => t.name === 'create_deploy_plan');

    expect(tool).toBeDefined();

    const mockPlan = {
      plan_id: 'plan_123',
      status: 'ready',
      complexity: 'simple',
      app: { name: 'test-app' },
      build: { method: 'dockerfile', dockerfile: 'Dockerfile', context: '.' },
      services: [],
      env: { required: [], auto: {}, provided: {}, detected: [] },
      missing: [],
      warnings: [],
    };

    (ctx.planEngine.createPlan as any).mockResolvedValue(mockPlan);

    const result = await tool!.execute(
      { repo_url: 'https://github.com/test/repo' },
      { target: 'mcp' },
    );

    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/test/repo',
      branch: undefined,
      name: undefined,
      envVars: undefined,
      preferDockerfile: undefined,
      dockerfilePath: undefined,
      dockerTarget: undefined,
    });

    expect(result).toEqual({
      plan_id: 'plan_123',
      status: 'ready',
      complexity: 'simple',
      app: { name: 'test-app' },
      build: { method: 'dockerfile', dockerfile: 'Dockerfile', context: '.' },
      services: [],
      env: { required: [], auto: {}, provided_count: 0, detected: [] },
      missing: [],
      warnings: [],
    });
  });

  it('update_deploy_plan calls planEngine.updatePlan', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((t) => t.name === 'update_deploy_plan');

    expect(tool).toBeDefined();

    const mockPlan = {
      plan_id: 'plan_123',
      status: 'ready',
      complexity: 'simple',
      app: {
        name: 'test-app',
        source: { repo_url: 'https://github.com/test/repo', branch: 'main', commit_sha: 'abc123' },
      },
      build: { method: 'dockerfile', dockerfile: 'Dockerfile', context: '.' },
      services: [],
      env: { required: [], auto: {}, provided: {}, detected: [] },
      missing: [],
      warnings: [],
    };

    (ctx.planEngine.updatePlan as any).mockReturnValue(mockPlan);

    const result = await tool!.execute(
      { plan_id: 'plan_123', updates: '{"env":{"DATABASE_URL":"postgres://..."}}' },
      { target: 'mcp' },
    );

    expect(ctx.planEngine.updatePlan).toHaveBeenCalledWith('plan_123', {
      env: { DATABASE_URL: 'postgres://...' },
    });

    expect(result).toMatchObject({
      plan_id: 'plan_123',
      status: 'ready',
      missing: [],
    });
  });

  it('execute_deploy_plan calls planEngine.executePlan and returns project_id on success', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((t) => t.name === 'execute_deploy_plan');

    expect(tool).toBeDefined();

    (ctx.planEngine.executePlan as any).mockResolvedValue({
      status: 'building',
      plan_id: 'plan_123',
      project_name: 'test-app',
      project_id: 'proj_456',
      estimated_seconds: 60,
    });

    const result = await tool!.execute({ plan_id: 'plan_123' }, { target: 'mcp' });

    expect(ctx.planEngine.executePlan).toHaveBeenCalledWith('plan_123', undefined);

    expect(result).toEqual({
      plan_id: 'plan_123',
      status: 'building',
      project_name: 'test-app',
      project_id: 'proj_456',
      estimated_seconds: 60,
    });
  });

  it('execute_deploy_plan returns error on failure', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((t) => t.name === 'execute_deploy_plan');

    expect(tool).toBeDefined();

    (ctx.planEngine.executePlan as any).mockResolvedValue({
      status: 'failed',
      plan_id: 'plan_123',
      project_name: 'test-app',
      error: 'Service creation failed',
    });

    const result = await tool!.execute({ plan_id: 'plan_123' }, { target: 'mcp' });

    expect(result).toEqual({
      plan_id: 'plan_123',
      status: 'failed',
      error: 'Service creation failed',
    });
  });
});
