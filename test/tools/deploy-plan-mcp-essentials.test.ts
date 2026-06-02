import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { DeployPlan } from '../../src/pipeline/deploy-plan/types.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import type { ToolContext, ToolDef } from '../../src/tools/defs/types.js';

function getTool(name: string): ToolDef {
  const tool = deployPlanToolDefs.find((def) => def.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function createPlan(overrides: Partial<DeployPlan> = {}): DeployPlan {
  return {
    plan_id: 'plan-1',
    status: 'ready',
    complexity: 'simple',
    app: { name: 'demo-app' },
    build: { method: 'dockerfile' },
    services: [],
    env: {
      required: [],
      auto: {},
      provided: {},
      detected: [],
    },
    missing: [],
    warnings: [],
    ...overrides,
  } as DeployPlan;
}

function createContext(appCtx: unknown): ToolContext {
  return {
    target: 'mcp',
    appCtx: appCtx as AppContext,
  };
}

describe('deploy plan MCP essentials', () => {
  it('get_deploy_plan returns a compact plan with execute suggested_call', async () => {
    const plan = createPlan();
    const context = createContext({
      db: {
        getDeployPlan: vi.fn(() => ({
          id: 'plan-1',
          status: 'ready',
          complexity: 'simple',
          project_id: 'proj-1',
          project_name: 'demo-app',
          commit_sha: 'abc123',
          error_message: null,
          plan_json: JSON.stringify(plan),
        })),
      },
    });

    const result = (await getTool('get_deploy_plan').execute(
      { plan_id: 'plan-1' },
      context,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      plan_id: 'plan-1',
      status: 'ready',
      project_id: 'proj-1',
      project_name: 'demo-app',
      suggested_call: {
        tool: 'openlander_deploy',
        action: 'execute_deploy_plan',
        params: { plan_id: 'plan-1' },
      },
    });
  });

  it('get_deploy_plan returns structured not_found guidance', async () => {
    const context = createContext({
      db: {
        getDeployPlan: vi.fn(() => undefined),
      },
    });

    const result = await getTool('get_deploy_plan').execute({ plan_id: 'missing-plan' }, context);

    expect(result).toMatchObject({
      status: 'not_found',
      error: 'DEPLOY_PLAN_NOT_FOUND',
      code: 'DEPLOY_PLAN_NOT_FOUND',
      plan_id: 'missing-plan',
      suggested_call: {
        tool: 'openlander_deploy',
        action: 'create_deploy_plan',
        params: { repo_url: '<repo_url>' },
      },
    });
  });

  it('cancel_deploy resolves project_name and cancels the active build stream', async () => {
    const cancelBuild = vi.fn(() => true);
    const context = createContext({
      db: {
        getProjectByName: vi.fn(() => ({
          id: 'proj-1',
          name: 'demo-app',
        })),
      },
      docker: { cancelBuild },
    });

    const result = await getTool('cancel_deploy').execute({ project_name: 'demo-app' }, context);

    expect(cancelBuild).toHaveBeenCalledWith('proj-1');
    expect(result).toMatchObject({
      status: 'cancelled',
      cancelled: true,
      project_id: 'proj-1',
      project_name: 'demo-app',
      resolved_from: 'project_name',
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { project_id: 'proj-1', project_name: 'demo-app' },
      },
    });
  });

  it('cancel_deploy resolves deploy_id through the deploy log service_id', async () => {
    const cancelBuild = vi.fn(() => false);
    const context = createContext({
      db: {
        getDeployLog: vi.fn(() => ({
          id: 'deploy-1',
          service_id: 'proj-1__svc',
        })),
        getService: vi.fn(() => ({ project_id: 'proj-1' })),
        getProject: vi.fn(() => ({ id: 'proj-1', name: 'demo-app' })),
      },
      docker: { cancelBuild },
    });

    const result = await getTool('cancel_deploy').execute({ deploy_id: 'deploy-1' }, context);

    expect(cancelBuild).toHaveBeenCalledWith('proj-1');
    expect(result).toMatchObject({
      status: 'not_active',
      cancelled: false,
      deploy_id: 'deploy-1',
      resolved_from: 'deploy_id',
    });
  });
});
