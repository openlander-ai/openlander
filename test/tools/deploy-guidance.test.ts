import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { eventBus } from '../../src/events/index.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('deploy MCP guidance', () => {
  afterEach(() => {
    eventBus.clear('deploy:success');
    eventBus.clear('deploy:failed');
  });

  it('points existing project failures at redeploy_app with a concrete service id', async () => {
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

    const result = (await getTool(ctx, 'deploy_app').execute(
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
        action: 'redeploy_app',
        params: { service_id: 'app__svc' },
      },
    });
    expect(result._agent_guidance).toMatchObject({
      next_steps: expect.arrayContaining([
        expect.stringContaining('openlander_service.redeploy_app'),
      ]),
    });
  });

  it('reports unhealthy readiness instead of claiming deploy success', async () => {
    const project = {
      id: 'app',
      name: 'app',
      status: 'running',
      container_id: 'container-1',
      archived_at: null,
    };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      kind: 'git',
      source: 'git',
      status: 'running',
      container_id: 'container-1',
    };
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        acquireDeployLock: vi.fn(async () => true),
        getDeployLockInfo: vi.fn(async () => null),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            Health: { Status: 'unhealthy' },
          },
        })),
      },
      jobManager: {
        getStatus: vi.fn(() => null),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'ready',
          app: { name: 'app' },
          project_id: 'app',
          missing: [],
          warnings: [],
        })),
        executePlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'building',
          project_name: 'app',
          project_id: 'app',
          estimated_seconds: 60,
        })),
      },
    } as unknown as AppContext;

    const pending = getTool(ctx, 'deploy_app').execute(
      {
        repo_url: 'https://github.com/acme/app',
        name: 'app',
        wait: true,
        wait_healthy: false,
      },
      { target: 'mcp' },
    );
    await vi.waitFor(() => expect(eventBus.listenerCount('deploy:success')).toBeGreaterThan(0));
    await eventBus.emit('deploy:success', {
      projectId: 'app',
      url: 'http://app.example.com',
      totalDurationMs: 1000,
    });

    const result = (await pending) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'unhealthy',
      readiness: 'unhealthy',
      readiness_message: 'Container healthcheck is unhealthy.',
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
        ]),
      },
    });
  });
});
