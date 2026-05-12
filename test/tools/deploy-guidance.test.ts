import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('deploy MCP guidance', () => {
  it('points existing project failures at deploy_service with a concrete service id', async () => {
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      kind: 'git',
      source: 'git',
      status: 'running',
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        acquireDeployLock: vi.fn(async () => true),
        getDeployLockInfo: vi.fn(async () => null),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'ready',
          app: { name: 'app' },
          missing: [],
          warnings: [],
        })),
        executePlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'failed',
          project_name: 'app',
          error: 'Container "ol-app" already exists',
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy').execute(
      { repo_url: 'https://github.com/acme/app', name: 'app', wait: false },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'failed',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'deploy_service',
        params: { service_id: 'app__svc' },
      },
    });
    expect(result._agent_guidance).toMatchObject({
      next_steps: expect.arrayContaining([
        expect.stringContaining('openlander_service.deploy_service'),
      ]),
    });
  });
});
