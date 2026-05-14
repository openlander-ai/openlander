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

  it('routes deploy_app to redeploy_app when name matches one existing deployable service', async () => {
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
        getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        isCircuitBreakerOpen: vi.fn(async () => false),
        acquireDeployLock: vi.fn(async () => true),
        getDeployLockInfo: vi.fn(async () => null),
        releaseDeployLock: vi.fn(async () => undefined),
      },
      pipeline: {
        redeploy: vi.fn(async () => undefined),
      },
      planEngine: {
        createPlan: vi.fn(),
        executePlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      { repo_url: 'https://github.com/acme/app', name: 'app', wait: false },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'deploying',
      mode: 'redeploy_existing_project',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeploy).toHaveBeenCalledWith('app', expect.anything()),
    );
  });

  it('routes deploy_app to redeploy_app when project_name matches one existing deployable service', async () => {
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
        getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
        getDeployableForProject: vi.fn(async (id: string) => (id === project.id ? service : null)),
        isCircuitBreakerOpen: vi.fn(async () => false),
        acquireDeployLock: vi.fn(async () => true),
        getDeployLockInfo: vi.fn(async () => null),
        releaseDeployLock: vi.fn(async () => undefined),
      },
      pipeline: {
        redeploy: vi.fn(async () => undefined),
      },
      planEngine: {
        createPlan: vi.fn(),
        executePlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      { project_name: 'app', wait: false },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'deploying',
      mode: 'redeploy_existing_project',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeploy).toHaveBeenCalledWith('app', expect.anything()),
    );
  });

  it('asks for service selection when deploy_app name matches multiple deployables', async () => {
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const services = [
      {
        id: 'app__web',
        name: 'web',
        project_id: 'app',
        kind: 'git',
        source: 'git',
        status: 'running',
      },
      {
        id: 'app__api',
        name: 'api',
        project_id: 'app',
        kind: 'git',
        source: 'git',
        status: 'running',
      },
    ];
    const ctx = {
      db: {
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => services),
        listServices: vi.fn(async () => services),
      },
      planEngine: {
        createPlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      { repo_url: 'https://github.com/acme/app', name: 'app' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'needs_selection',
      code: 'SERVICE_SELECTION_REQUIRED',
      candidate_services: [
        { service_id: 'app__web', service_name: 'web' },
        { service_id: 'app__api', service_name: 'api' },
      ],
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
  });

  it('rejects project_name as a new deploy_app name', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => undefined),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'needs_input',
          missing: ['PORT'],
          warnings: [],
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        source: 'image',
        image: 'httpd:latest',
        project_name: 'my-custom-name-123',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'INVALID_PARAMS',
      action: 'deploy_app',
      invalid_params: ['project_name'],
      allowed_params: expect.arrayContaining(['name']),
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
  });

  it('uses name as the new deploy_app project name', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => undefined),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'needs_input',
          missing: ['PORT'],
          warnings: [],
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        source: 'image',
        image: 'httpd:latest',
        name: 'my-custom-name-123',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({ status: 'needs_input' });
    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'httpd:latest',
        name: 'my-custom-name-123',
        source: 'image',
      }),
    );
  });

  it('uses name as the create_deploy_plan app name', async () => {
    const ctx = {
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'ready',
          complexity: 'simple',
          app: { name: 'qa-name-check' },
          build: {},
          services: [],
          env: { required: [], auto: [], provided: {}, detected: {} },
          missing: [],
          warnings: [],
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'create_deploy_plan').execute(
      {
        source: 'image',
        image: 'httpd:latest',
        name: 'qa-name-check',
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'ready',
      app: { name: 'qa-name-check' },
    });
    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'httpd:latest',
        name: 'qa-name-check',
        source: 'image',
      }),
    );
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
        getProject: vi.fn(() => undefined),
        getProjectByName: vi.fn(() => undefined),
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
