import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppContext } from '../src/app.js';
import { DockerfileSelectionRequiredError } from '../src/errors.js';
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

  it('deploy_project is NOT in tool registry (replaced by deploy plan engine)', () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const toolNames = registry.map((tool) => tool.name);

    expect(toolNames).not.toContain('deploy_project');
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

    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/test/repo',
        branch: undefined,
        name: undefined,
        preferDockerfile: undefined,
        dockerfilePath: undefined,
        dockerTarget: undefined,
      }),
    );

    expect(result).toMatchObject({
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

  it('returns structured Dockerfile selection guidance for one Application per plan', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((candidate) => candidate.name === 'create_deploy_plan');
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DockerfileSelectionRequiredError(['Dockerfile', 'apps/worker/Dockerfile']),
    );

    const result = await tool!.execute(
      {
        repo_url: 'https://github.com/test/repo',
        name: 'worker',
        target_project_id: 'suite',
      },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'needs_selection',
      code: 'DOCKERFILE_SELECTION_REQUIRED',
      candidate_dockerfiles: ['Dockerfile', 'apps/worker/Dockerfile'],
      target_project_id: 'suite',
      suggested_call: {
        tool: 'openlander_deploy',
        action: 'create_deploy_plan',
        params: {
          repo_url: 'https://github.com/test/repo',
          name: 'worker',
          target_project_id: 'suite',
          dockerfile_path: 'Dockerfile',
        },
      },
    });
  });

  it('keeps deploy_app on the same structured Dockerfile selection contract', async () => {
    const ctx = createMockContext();
    const registry = createSharedToolRegistry(ctx);
    const tool = registry.find((candidate) => candidate.name === 'deploy_app');
    (ctx.planEngine.createPlan as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DockerfileSelectionRequiredError(['api/Dockerfile', 'worker/Dockerfile']),
    );

    const result = await tool!.execute(
      {
        repo_url: 'https://github.com/test/repo',
        name: 'worker',
        target_project_id: 'suite',
      },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'needs_selection',
      code: 'DOCKERFILE_SELECTION_REQUIRED',
      suggested_call: {
        tool: 'openlander_deploy',
        action: 'deploy_app',
        params: {
          target_project_id: 'suite',
          dockerfile_path: 'api/Dockerfile',
        },
      },
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

    expect(ctx.planEngine.executePlan).toHaveBeenCalledWith(
      'plan_123',
      undefined,
      expect.any(String),
      'chat',
      {},
    );

    expect(result).toMatchObject({
      plan_id: 'plan_123',
      status: 'building',
      project_name: 'test-app',
      project_id: 'proj_456',
      estimated_seconds: 60,
      _agent_guidance: {
        next_steps: ['Poll get_deploy_status to monitor build progress'],
      },
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

    expect(result).toMatchObject({
      plan_id: 'plan_123',
      status: 'failed',
      error: 'Service creation failed',
      _agent_guidance: {
        next_steps: [
          'Check the error message above — this is a preflight failure (before build started)',
          'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
        ],
      },
    });
  });
});
