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
    vi.useRealTimers();
  });

  it('routes deploy_app to update_app when name matches one existing deployable service', async () => {
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
        name: 'app',
        env_vars: { DATABASE_URL: 'postgresql://example' },
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
	      status: 'deploying',
	      delegated_action: 'update_app',
	      mode: 'redeploy_existing_project',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { service_id: 'app__svc' },
      },
    });
	    expect(result['_agent_guidance']).toMatchObject({
	      message:
	        'This Project already has one Application/Compose workload. OpenLander started an update of the existing workload; do not create a new app. Poll status_call until terminal.',
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

  // Regression pin (2026-06-07): deploy_app delegation to an existing service must resolve the
  // deploy strategy exactly like redeploy_app — eligible -> blue-green, explicit -> respected,
  // ineligible -> force fallback with a reason. Guards against re-misreading a force *fallback*
  // (or an explicit operator force) as a "delegation defaults to force" platform gap.
  const makeExistingServiceDeployCtx = (eligibility?: {
    supported: boolean;
    reasons?: string[];
  }) => {
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
    return {
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
        ...(eligibility
          ? { getBlueGreenEligibility: vi.fn(async () => eligibility) }
          : {}),
      },
      env: {
        setBulkForServiceDetailed: vi.fn(async () => []),
        verifyRoundTripForService: vi.fn(async () => []),
      },
      planEngine: { createPlan: vi.fn(), executePlan: vi.fn() },
    } as unknown as AppContext;
  };

  it('deploy_app delegation auto-selects blue-green for an eligible existing service', async () => {
    const ctx = makeExistingServiceDeployCtx({ supported: true });
    const result = (await getTool(ctx, 'deploy_app').execute(
      { name: 'app', wait: false },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      mode: 'redeploy_existing_project',
      strategy: 'blue-green',
      zero_downtime: true,
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'app__svc',
        expect.objectContaining({ strategy: 'blue-green' }),
      ),
    );
  });

  it('deploy_app delegation respects an explicit strategy:force (no eligibility check)', async () => {
    const ctx = makeExistingServiceDeployCtx({ supported: true });
    await getTool(ctx, 'deploy_app').execute(
      { name: 'app', strategy: 'force', wait: false },
      { target: 'mcp' },
    );

    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'app__svc',
        expect.objectContaining({ strategy: 'force' }),
      ),
    );
    // explicit strategy short-circuits the resolver — eligibility is never consulted
    expect(ctx.pipeline.getBlueGreenEligibility).not.toHaveBeenCalled();
  });

  it('deploy_app delegation falls back to force with a reason when ineligible for blue-green', async () => {
    const ctx = makeExistingServiceDeployCtx({
      supported: false,
      reasons: ['No managed OpenLander Traefik route configured.'],
    });
    const result = (await getTool(ctx, 'deploy_app').execute(
      { name: 'app', wait: false },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({ strategy: 'force' });
    expect(result['zero_downtime']).toBeUndefined();
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'app__svc',
        expect.objectContaining({ strategy: 'force' }),
      ),
    );
    // force fallback must surface WHY blue-green was skipped (survives the delegation guidance merge)
    expect(JSON.stringify(result)).toContain('blue-green is not currently eligible');
  });

  it('rejects source/build overrides when deploy_app resolves an existing service by name', async () => {
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
        getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
        getDeployablesByGroup: vi.fn(async () => [service]),
        listServices: vi.fn(async () => [service]),
      },
      pipeline: {
        redeployService: vi.fn(async () => undefined),
      },
      planEngine: {
        createPlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        name: 'app',
        repo_url: 'https://github.com/acme/app',
        branch: 'staging',
        dockerfile_path: 'Dockerfile.broken',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'EXISTING_SERVICE_SOURCE_OVERRIDE_UNSUPPORTED',
      code: 'EXISTING_SERVICE_SOURCE_OVERRIDE_UNSUPPORTED',
      action: 'deploy_app',
      invalid_params: ['repo_url', 'branch', 'dockerfile_path'],
      allowed_params: expect.arrayContaining(['no_cache', 'strategy', 'health_check_path']),
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
    });
    expect(result['suggested_call']).toBeUndefined();
    expect(result['allowed_params']).toEqual(
      expect.not.arrayContaining(['wait', 'wait_healthy', 'timeout']),
    );
    const guidance = result['_agent_guidance'] as Record<string, unknown>;
    expect(String(guidance['message'])).toContain('did not start an update');
    expect((guidance['next_steps'] as string[]).join('\n')).toContain('update_service_config');
    expect((guidance['next_steps'] as string[]).join('\n')).toContain('update_application_source');
    expect((guidance['next_steps'] as string[]).join('\n')).toContain(
      'latest stored source revision',
    );
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
  });

  it('rejects source overrides when deploy_app resolves an existing service by service_id', async () => {
    const ctx = {
      pipeline: {
        redeployService: vi.fn(async () => undefined),
      },
      planEngine: {
        createPlan: vi.fn(),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        service_id: 'app__svc',
        branch: 'staging',
        repo_url: 'https://github.com/acme/app',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'EXISTING_SERVICE_SOURCE_OVERRIDE_UNSUPPORTED',
      invalid_params: ['repo_url', 'branch'],
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_application_source',
        params: {
          service_id: 'app__svc',
          repo_url: 'https://github.com/acme/app',
          branch: 'staging',
        },
      },
    });
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
    expect(ctx.planEngine.createPlan).not.toHaveBeenCalled();
  });

  it('routes deploy_app to update_app when project_name matches one existing deployable service', async () => {
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
	      delegated_action: 'update_app',
	      mode: 'redeploy_existing_project',
      existing_service: {
        service_id: 'app__svc',
        service_name: 'web',
      },
    });
	    expect(result['_agent_guidance']).toMatchObject({
	      message:
	        'This Project already has one Application/Compose workload. OpenLander started an update of the existing workload; do not create a new app. Poll status_call until terminal.',
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
        health_check_path: '/healthz',
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
        healthCheckPath: '/healthz',
        trigger: 'chat',
      }),
    );
  });

  it('surfaces env value requirements when deploy_app returns needs_input', async () => {
    const ctx = {
      db: {
        getProject: vi.fn(() => undefined),
        getProjectByName: vi.fn(() => undefined),
      },
      planEngine: {
        createPlan: vi.fn(async () => ({
          plan_id: 'plan-env',
          status: 'needs_input',
          missing: ['STRIPE_API_KEY'],
          warnings: [],
          env: {
            required: ['STRIPE_API_KEY'],
            auto: {},
            provided: {},
            detected: [
              {
                key: 'STRIPE_API_KEY',
                source: 'config schema',
                required: true,
                requirement: { kind: 'prefix', source: 'key_name', prefix: 'sk_' },
              },
            ],
          },
        })),
      },
    } as unknown as AppContext;

    const result = (await getTool(ctx, 'deploy_app').execute(
      {
        source: 'image',
        image: 'httpd:latest',
        name: 'needs-env',
        wait: false,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'needs_input',
      missing: ['STRIPE_API_KEY'],
      input_requirements: [
        expect.objectContaining({
          key: 'STRIPE_API_KEY',
          requirement: expect.objectContaining({
            kind: 'prefix',
            prefix: 'sk_',
            guidance: expect.stringContaining('real Stripe secret key'),
          }),
        }),
      ],
      action_summary: {
        reason: 'missing_env',
        first_blocker: 'STRIPE_API_KEY: value required',
        required_action: 'update_deploy_plan',
        ask_user_for: [
          expect.objectContaining({
            key: 'STRIPE_API_KEY',
            trusted_confirmation_required: true,
          }),
        ],
        update_payload_template: {
          plan_id: 'plan-env',
          updates: {
            env: {
              provided: {
                STRIPE_API_KEY: '<real STRIPE_API_KEY value from user>',
              },
              trusted: ['STRIPE_API_KEY'],
            },
          },
        },
        after_update: 'execute_deploy_plan',
      },
    });
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
        health_check_path: '/ready',
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
        healthCheckPath: '/ready',
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

  it('reports recent restart loops instead of claiming deploy success', async () => {
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
          RestartCount: 7,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
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
      readiness_message: expect.stringContaining('restarted 7 times recently'),
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
        ]),
      },
    });
  });

  it('does not fail deploy readiness for old restart counts after the app stabilizes', async () => {
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
          RestartCount: 7,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            Health: { Status: 'healthy' },
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
      status: 'done',
      readiness: 'healthy',
    });
    expect(result['readiness_message']).toBeUndefined();
  });

  it('marks deploy_app wait result unhealthy when representative public traffic returns 5xx', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-05T00:00:00.000Z') });
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
      assigned_port: 3000,
      public_url: null,
    };
    const ctx = {
      config: {
        traefik: { mode: 'managed' },
      },
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
          RestartCount: 0,
          State: {
            Running: true,
            Restarting: false,
            ExitCode: 0,
            StartedAt: new Date(Date.now() - 10_000).toISOString(),
            Health: { Status: 'healthy' },
          },
        })),
      },
      pipeline: {
        verifyManagedTraefikRoute: vi.fn(async () => ({
          ok: false,
          status: 500,
          error: 'Route probe returned HTTP 500',
          attempts: 1,
          elapsedMs: 4,
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
      },
      { target: 'mcp' },
    );
    await vi.waitFor(() => expect(eventBus.listenerCount('deploy:success')).toBeGreaterThan(0));
    await eventBus.emit('deploy:success', {
      projectId: 'app',
      url: 'http://app.example.com',
      totalDurationMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(12_000);

    const result = (await pending) as Record<string, unknown>;

    expect(ctx.pipeline.verifyManagedTraefikRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'app',
        path: '/',
        probeTimeoutMs: 1_000,
        maxWaitMs: 2_500,
        intervalMs: 500,
        minimumSuccessAgeMs: 0,
      }),
    );
    expect(result).toMatchObject({
      status: 'unhealthy',
      readiness: 'healthy',
      representative_traffic: {
        status: 'failed',
        severity: 'fail',
        path: '/',
        status_code: 500,
      },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          'Do not report end-user success until the public route returns a non-5xx response',
        ]),
      },
    });
    expect(result['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('HTTP 500')]),
    );
  });

  it('observes post-deploy stability and warns when a healthy app starts crashing', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-05T00:00:00.000Z') });
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
    const inspectContainer = vi
      .fn()
      .mockResolvedValueOnce({
        RestartCount: 0,
        State: {
          Running: true,
          Restarting: false,
          ExitCode: 0,
          StartedAt: new Date(Date.now()).toISOString(),
          Health: { Status: 'healthy' },
        },
      })
      .mockResolvedValueOnce({
        RestartCount: 4,
        State: {
          Running: true,
          Restarting: false,
          ExitCode: 0,
          StartedAt: new Date(Date.now() + 1_000).toISOString(),
          Health: { Status: 'healthy' },
        },
      });
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
        inspectContainer,
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
      },
      { target: 'mcp' },
    );
    await vi.waitFor(() => expect(eventBus.listenerCount('deploy:success')).toBeGreaterThan(0));
    await eventBus.emit('deploy:success', {
      projectId: 'app',
      url: 'http://app.example.com',
      totalDurationMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(2_000);

    const result = (await pending) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'unhealthy',
      readiness: 'unhealthy',
      readiness_message: expect.stringContaining('restarted 4 times recently'),
      post_deploy_stability: {
        status: 'unstable',
        readiness: 'unhealthy',
        observed_ms: 2000,
      },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'app__svc' },
      },
    });
    expect(result['warnings']).toEqual(
      expect.arrayContaining([expect.stringContaining('restarted 4 times recently')]),
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
    expect(JSON.stringify(result._agent_guidance)).toContain('execute_deploy_plan will create/own');
    expect(JSON.stringify(result._agent_guidance)).not.toContain('create_project');
    // Must NOT proceed to execute — approval has not been given.
    expect(ctx.planEngine.executePlan).not.toHaveBeenCalled();
  });
});
