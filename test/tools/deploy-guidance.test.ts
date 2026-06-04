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
      repo_url: 'https://github.com/acme/app',
      image_url: null,
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
        redeployService: vi.fn(async () => undefined),
      },
      env: {
        setBulkForServiceDetailed: vi.fn(async () => [{ key: 'DATABASE_URL', op: 'set' }]),
        verifyRoundTripForService: vi.fn(async () => []),
      },
      planEngine: {
        createPlan: vi.fn(),
        executePlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        repo_url: 'https://github.com/acme/app',
        name: 'app',
        env_vars: { DATABASE_URL: 'postgresql://example' },
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'deploying',
      mode: 'redeploy_existing_project',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { project_id: 'app' },
      },
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
    expect(ctx.env.setBulkForServiceDetailed).toHaveBeenCalledWith('app', 'app__svc', {
      DATABASE_URL: 'postgresql://example',
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'app__svc',
        expect.objectContaining({ trigger: 'chat' }),
      ),
    );
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('routes deploy_app to redeploy_app when project_name matches one existing deployable service', async () => {
    const project = { id: 'app', name: 'app', status: 'running', archived_at: null };
    const service = {
      id: 'app__svc',
      name: 'web',
      project_id: 'app',
      kind: 'git',
      source: 'git',
      repo_url: 'https://github.com/acme/app',
      image_url: null,
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
        redeployService: vi.fn(async () => undefined),
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
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'app__svc',
        expect.objectContaining({ trigger: 'chat' }),
      ),
    );
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
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
        repo_url: 'https://github.com/acme/app',
        image_url: null,
        status: 'running',
      },
      {
        id: 'app__api',
        name: 'api',
        project_id: 'app',
        kind: 'git',
        source: 'git',
        repo_url: 'https://github.com/acme/app',
        image_url: null,
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

  it('passes target_project_id into the durable deploy plan path', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => ({ id: 'target', name: 'target' })),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-target',
          status: 'ready',
          app: { name: 'new-app' },
          build: {},
          services: [],
          env: { required: [], auto: [], provided: {}, detected: [] },
          missing: [],
          warnings: [],
        })),
        executePlan: vi.fn(async () => ({
          status: 'building',
          plan_id: 'plan-target',
          project_name: 'new-app',
          project_id: 'runtime-project',
          runtime_project_id: 'runtime-project',
          target_project_id: 'target',
          service_id: 'runtime-project__svc',
          estimated_seconds: 60,
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        repo_url: 'https://github.com/acme/new-app',
        name: 'new-app',
        target_project_id: 'target',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'building',
      project_id: 'runtime-project',
      runtime_project_id: 'runtime-project',
      target_project_id: 'target',
      service_id: 'runtime-project__svc',
      target_attach_status: 'pending',
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          expect.stringContaining('attach to target_project_id'),
        ]),
      },
    });
    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new-app',
        repoUrl: 'https://github.com/acme/new-app',
        targetProjectId: 'target',
      }),
    );
    expect(ctx.planEngine.executePlan).toHaveBeenCalledWith(
      'plan-target',
      undefined,
      expect.stringMatching(/^mcp-deploy-/),
      'chat',
    );
  });

  it('blocks target_project_id with expose=true before creating a temp project', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => ({ id: 'target', name: 'target' })),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(),
        executePlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        repo_url: 'https://github.com/acme/new-app',
        name: 'new-app',
        target_project_id: 'target',
        expose: true,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'TARGET_PROJECT_EXPOSE_UNSUPPORTED',
      invalid_params: ['target_project_id', 'expose'],
      _agent_guidance: {
        message: expect.stringContaining('did not create a temp project'),
      },
    });
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
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
        trigger: 'chat',
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
        trigger: 'chat',
      }),
    );
  });

  it('executes deploy plans with MCP deploy trigger so Activity shows MCP actor', async () => {
    const plan = {
      plan_id: 'plan-1',
      project_id: 'app',
      app: { name: 'app' },
    };
    const ctx = {
      db: {
        getDeployPlan: vi.fn(() => ({ plan_json: JSON.stringify(plan) })),
        getProjectByName: vi.fn(() => ({ id: 'app', name: 'app' })),
        acquireDeployLock: vi.fn(async () => true),
        getDeployLockInfo: vi.fn(async () => null),
      },
      planEngine: {
        executePlan: vi.fn(async () => ({
          plan_id: 'plan-1',
          status: 'building',
          project_name: 'app',
          project_id: 'app',
          estimated_seconds: 60,
        })),
      },
    } as unknown as AppContext;

    await getTool(ctx, 'execute_deploy_plan').execute({ plan_id: 'plan-1' }, { target: 'mcp' });

    expect(ctx.planEngine.executePlan).toHaveBeenCalledWith(
      'plan-1',
      undefined,
      expect.stringMatching(/^mcp-execute-plan-/),
      'chat',
      {},
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
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getServices: vi.fn(async (query?: { ids?: string[] }) =>
          query?.ids?.includes(service.id) ? [service] : [],
        ),
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

    expect(ctx.planEngine.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'chat' }),
    );
    expect(ctx.planEngine.executePlan).toHaveBeenCalledWith(
      'plan-1',
      undefined,
      expect.stringMatching(/^mcp-deploy-/),
      'chat',
    );
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
        getServices: vi.fn(async (query?: { ids?: string[] }) =>
          query?.ids?.includes(service.id) ? [service] : [],
        ),
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

  // deploy_app needs_approval gate: a new-app plan that proposes a safe managed
  // resource must return needs_approval with the approval contract and must NOT
  // call executePlan — the caller must confirm with the user first.
  it('returns needs_approval with approval_required and never calls executePlan when createPlan yields needs_approval', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => undefined),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-needs-approval',
          status: 'needs_approval',
          services: [
            {
              type: 'postgresql',
              action: 'create',
              connect_via: 'DATABASE_URL',
              resolution: 'proposed_project_service',
              approval: 'safe_resource',
              reason: 'pg detected',
            },
          ],
          missing: [],
          warnings: [],
        })),
        executePlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        repo_url: 'https://github.com/acme/new-app',
        name: 'new-app',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      plan_id: 'plan-needs-approval',
      status: 'needs_approval',
      approval_required: { create_resources: ['postgresql'] },
    });
    expect(result.services).toBeDefined();
    expect((result.services as unknown[]).length).toBeGreaterThan(0);
    expect(result._agent_guidance).toBeDefined();
    // Must NOT proceed to execute — approval has not been given.
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });
});
