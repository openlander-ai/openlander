import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

import { PlanEngine } from '../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../src/pipeline/deploy-plan/engine.js';
import { createMockDeployPlan } from './helpers/deploy-plan-mocks.js';
import * as infraAnalyzer from '../src/lib/infra-analyzer.js';

describe('PlanEngine.updatePlan', () => {
  let engine: PlanEngine;
  let mockDb: any;
  let mockPipeline: any;
  let mockEnv: any;
  let mockServiceManager: any;
  let mockAutoDetector: any;
  let mockConfig: any;
  let mockAnalyzeInfra: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockAnalyzeInfra = vi.spyOn(infraAnalyzer, 'analyzeInfrastructure');
    mockDb = {
      createDeployPlan: vi.fn(),
      getDeployPlan: vi.fn(),
      updateDeployPlan: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockReturnValue([]),
    };

    mockPipeline = {
      deploy: vi.fn().mockResolvedValue({ success: true, projectId: 'p1' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockServiceManager = {
      create: vi.fn().mockResolvedValue({}),
    };

    mockAutoDetector = {};
    mockConfig = {};

    const deps: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
    };

    engine = new PlanEngine(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockAnalyzeInfra.mockRestore();
  });

  it('fills missing env var with flat format { env: { DATABASE_URL: "postgres://..." } }', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: {
        DATABASE_URL: 'postgres://localhost/db',
      },
    });

    expect(updated.env.provided).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
    });
    expect(updated.missing).toHaveLength(0);
    expect(updated.status).toBe('ready');
  });

  it('fills missing env var with structured format { env: { provided: { DATABASE_URL: "..." } } }', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: {
        provided: {
          DATABASE_URL: 'postgres://localhost/db',
        },
      },
    });

    expect(updated.env.provided).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
    });
    expect(updated.missing).toHaveLength(0);
    expect(updated.status).toBe('ready');
  });

  // P1-1 status-priority gate on updatePlan: a plan that starts needs_input
  // (missing user secret) AND carries a safe proposed managed resource must
  // become needs_approval (NOT ready) once the secret is filled — otherwise the
  // approval gate is skipped and provisioning runs with no approved resources.
  it('transitions needs_input → needs_approval (not ready) when a filled secret coexists with a safe proposed resource', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      services: [
        {
          type: 'postgresql',
          action: 'create',
          connect_via: 'DATABASE_URL',
          resolution: 'proposed_project_service',
          approval: 'safe_resource',
          reason: 'pg',
        },
      ],
      env: {
        auto: {},
        required: ['API_KEY'],
        provided: {},
        detected: [{ key: 'API_KEY', source: 'required', required: true }],
      },
      missing: ['API_KEY'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: { API_KEY: 'secret-value' },
    });

    expect(updated.missing).toHaveLength(0);
    // The safe proposed postgresql resource still needs approval, so the plan
    // must NOT downgrade to 'ready'.
    expect(updated.status).toBe('needs_approval');
    expect(updated.services.find((svc) => svc.type === 'postgresql')).toMatchObject({
      resolution: 'proposed_project_service',
      approval: 'safe_resource',
    });
  });

  it('throws error when updating plan in executing status', async () => {
    const plan = createMockDeployPlan({
      status: 'executing',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      }),
    ).rejects.toThrow('Cannot update plan in executing status');
  });

  it('throws error when updating plan in completed status', async () => {
    const plan = createMockDeployPlan({
      status: 'completed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      }),
    ).rejects.toThrow('Cannot update plan in completed status');
  });

  it('preserves unchanged fields during partial update', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      app: {
        name: 'my-app',
        source: {
          repo_url: 'https://github.com/test/repo',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
      },
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.app.name).toBe('my-app');
    expect(updated.app.source.repo_url).toBe('https://github.com/test/repo');
    expect(updated.build.dockerfile).toBe('Dockerfile');
    expect(updated.build.context).toBe('.');
  });

  it('handles invalid JSON in updates gracefully', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.status).toBe('ready');
    expect(updated.env.provided.DATABASE_URL).toBe('postgres://localhost/db');
  });

  it('throws error when plan not found', async () => {
    mockDb.getDeployPlan.mockReturnValue(null);

    await expect(
      engine.updatePlan('plan_nonexistent', {
        env: { TEST_VAR: 'value' },
      }),
    ).rejects.toThrow('Deploy plan not found: plan_nonexistent');
  });

  it('persists updated plan to database', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(mockDb.updateDeployPlan).toHaveBeenCalledWith(plan.plan_id, {
      status: 'ready',
      planJson: expect.any(String),
    });

    const savedPlan = JSON.parse(mockDb.updateDeployPlan.mock.calls[0][1].planJson);
    expect(savedPlan.status).toBe('ready');
    expect(savedPlan.missing).toHaveLength(0);
  });

  it('updates multiple env vars at once', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL', 'API_KEY', 'SECRET_TOKEN'],
        provided: {},
        detected: [],
      },
      missing: ['DATABASE_URL', 'API_KEY', 'SECRET_TOKEN'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: {
        DATABASE_URL: 'postgres://localhost/db',
        API_KEY: 'key123',
        SECRET_TOKEN: 'secret456',
      },
    });

    expect(updated.env.provided).toEqual({
      DATABASE_URL: 'postgres://localhost/db',
      API_KEY: 'key123',
      SECRET_TOKEN: 'secret456',
    });
    expect(updated.missing).toHaveLength(0);
    expect(updated.status).toBe('ready');
  });

  it('merges env vars with existing provided vars', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
      env: {
        auto: {},
        required: ['DATABASE_URL', 'API_KEY'],
        provided: {
          API_KEY: 'existing_key',
        },
        detected: [],
      },
      missing: ['DATABASE_URL'],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.env.provided).toEqual({
      API_KEY: 'existing_key',
      DATABASE_URL: 'postgres://localhost/db',
    });
    expect(updated.missing).toHaveLength(0);
  });

  it('updates build configuration', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      build: {
        context: './app',
        target: 'production',
      },
    });

    expect(updated.build.context).toBe('./app');
    expect(updated.build.target).toBe('production');
    expect(updated.build.dockerfile).toBe('Dockerfile');
  });

  it('updates health check configuration', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      health: {
        path: '/',
        retries: 10,
        interval_ms: 2000,
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const updated = await engine.updatePlan(plan.plan_id, {
      health: {
        path: '/health',
        retries: 5,
      },
    });

    expect(updated.health.path).toBe('/health');
    expect(updated.health.retries).toBe(5);
    expect(updated.health.interval_ms).toBe(2000);
  });

  it('throws error when updating plan in failed status', async () => {
    const plan = createMockDeployPlan({
      status: 'failed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      }),
    ).rejects.toThrow('Cannot update plan in failed status');
  });

  it('throws error when updating plan in rolled_back status', async () => {
    const plan = createMockDeployPlan({
      status: 'rolled_back',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      }),
    ).rejects.toThrow('Cannot update plan in rolled_back status');
  });
});

describe('PlanEngine.executePlan', () => {
  let engine: PlanEngine;
  let mockDb: any;
  let mockPipeline: any;
  let mockEnv: any;
  let mockServiceManager: any;
  let mockAutoDetector: any;
  let mockConfig: any;
  let mockEvents: any;

  beforeEach(() => {
    mockDb = {
      createDeployPlan: vi.fn(),
      getDeployPlan: vi.fn(),
      updateDeployPlan: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockReturnValue([]),
      getProject: vi.fn((id: string) => (id === 'p1' ? { id: 'p1', name: 'test-app' } : null)),
      getProjectByName: vi.fn().mockReturnValue(null),
      getService: vi.fn().mockReturnValue(null),
      getLastDeployLog: vi.fn().mockReturnValue(null),
      acquireDeployLock: vi.fn().mockResolvedValue(true),
      getDeployLockInfo: vi.fn().mockResolvedValue(null),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      upsertServiceConnection: vi.fn().mockResolvedValue(undefined),
      getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
      listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
      getDeployableForProject: vi.fn().mockResolvedValue(null),
      getDeployablesByGroup: vi.fn().mockResolvedValue([]),
      createProjectDependency: vi.fn().mockResolvedValue(undefined),
      attachServiceToProject: vi.fn().mockResolvedValue({
        sourceProjectId: 'orphan',
        targetProjectId: 'p1',
        droppedEnvVarKeys: [],
        droppedSecretFiles: [],
      }),
    };

    mockPipeline = {
      startDeploy: vi
        .fn()
        .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockServiceManager = {
      create: vi.fn().mockResolvedValue({
        credentials: JSON.stringify({ connectionString: 'postgres://localhost/db' }),
      }),
    };

    mockAutoDetector = {};
    mockConfig = {};
    mockEvents = {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
    };

    const deps: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      events: mockEvents,
    };

    engine = new PlanEngine(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('executes ready plan and calls pipeline.startDeploy with correct ProjectConfig', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      app: {
        name: 'test-app',
        source: {
          repo_url: 'https://github.com/test/repo',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      env: {
        auto: { DATABASE_URL: 'postgres://localhost' },
        required: ['DATABASE_URL'],
        provided: { API_KEY: 'key123' },
        detected: [],
      },
      services: [],
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(result.project_id).toBe('p1');
    expect(mockDb.getProjectByName).toHaveBeenCalledTimes(2);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/test/repo',
      branch: 'main',
      name: 'test-app',
      envVars: {
        DATABASE_URL: 'postgres://localhost',
        API_KEY: 'key123',
      },
      preferDockerfile: true,
    });
  });

  it('returns failure result when pipeline.startDeploy returns preflight_failed', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'preflight_failed',
      projectId: 'p1',
      projectName: 'test-app',
      preflightError: 'build failed',
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('build failed');
  });

  it('persists status to executing before deployment', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockImplementation(async () => {
      const updateCalls = mockDb.updateDeployPlan.mock.calls;
      const executingCall = updateCalls.find((call: any) => call[1].status === 'executing');
      expect(executingCall).toBeDefined();
      return { status: 'building', projectId: 'p1', projectName: 'test-app' };
    });

    await engine.executePlan(plan.plan_id);

    expect(mockDb.updateDeployPlan).toHaveBeenCalledWith(
      plan.plan_id,
      expect.objectContaining({
        status: 'executing',
      }),
    );
  });

  it('registers deploy event listeners after starting deployment', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockEvents.on).toHaveBeenCalledWith('deploy:success', expect.any(Function));
    expect(mockEvents.on).toHaveBeenCalledWith('deploy:failed', expect.any(Function));
  });

  it('persists status to failed after preflight failure', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'preflight_failed',
      projectId: 'p1',
      projectName: 'test-app',
      preflightError: 'build failed',
    });

    await engine.executePlan(plan.plan_id);

    const updateCalls = mockDb.updateDeployPlan.mock.calls;
    const failedCall = updateCalls.find((call: any) => call[1].status === 'failed');
    expect(failedCall).toBeDefined();
  });

  it('throws error when executing plan that is already executing (race condition)', async () => {
    const plan = createMockDeployPlan({
      status: 'executing',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Plan status is "executing" — only "ready" plans can be executed.',
    );
  });

  it('throws error when executing needs_input plan', async () => {
    const plan = createMockDeployPlan({
      status: 'needs_input',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Plan requires missing environment variables',
    );
  });

  it('fails implicit managed service creation and requires explicit env input', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [
        {
          type: 'postgresql',
          action: 'create',
          connect_via: 'DATABASE_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('requires an explicit DATABASE_URL value'),
    });
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  it('injects same-project reusable service credentials into environment variables', async () => {
    const reusableService = {
      id: 'same-project-pg',
      name: 'existing-postgres',
      project_id: 'p1',
      kind: 'postgres',
      credentials: JSON.stringify({ connectionString: 'postgres://service-host/db' }),
    };
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          service_id: reusableService.id,
          name: reusableService.name,
          connect_via: 'DATABASE_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });
    mockDb.getService.mockReturnValue(reusableService);

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          DATABASE_URL: 'postgres://service-host/db',
        }),
      }),
    );
    expect(mockServiceManager.create).not.toHaveBeenCalled();
  });

  it('registers deploy:success event listener on execution', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockEvents.on).toHaveBeenCalledWith('deploy:success', expect.any(Function));
  });

  it('throws error when plan not found', async () => {
    mockDb.getDeployPlan.mockReturnValue(null);

    await expect(engine.executePlan('plan_nonexistent')).rejects.toThrow(
      'Plan not found: plan_nonexistent',
    );
  });

  it('persists failure when implicit managed service creation is still present in an old plan', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [
        {
          type: 'postgresql',
          action: 'create',
          connect_via: 'DATABASE_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('requires an explicit DATABASE_URL value');
    expect(mockServiceManager.create).not.toHaveBeenCalled();
  });

  it('uses preferDockerfile: false when generated_dockerfile is set', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
        generated_dockerfile: 'auto-generated',
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        preferDockerfile: false,
      }),
    );
  });

  it('uses preferDockerfile: true when generated_dockerfile is not set', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        preferDockerfile: true,
      }),
    );
  });

  it('merges auto and provided env vars correctly', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      env: {
        auto: {
          DATABASE_URL: 'postgres://auto',
          REDIS_URL: 'redis://auto',
        },
        required: ['DATABASE_URL', 'REDIS_URL', 'API_KEY'],
        provided: {
          API_KEY: 'key123',
          DATABASE_URL: 'postgres://override',
        },
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: {
          DATABASE_URL: 'postgres://override',
          REDIS_URL: 'redis://auto',
          API_KEY: 'key123',
        },
      }),
    );
  });

  it('fails plans that still contain multiple implicit managed service creations', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [
        {
          type: 'postgresql',
          action: 'create',
          connect_via: 'DATABASE_URL',
        },
        {
          type: 'redis',
          action: 'create',
          connect_via: 'REDIS_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL', 'REDIS_URL'],
        provided: {},
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('requires an explicit DATABASE_URL value'),
    });
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  it('skips service creation for reuse action', async () => {
    const reusableService = {
      id: 'same-project-pg',
      name: 'existing-postgres',
      project_id: 'p1',
      kind: 'postgres',
      credentials: JSON.stringify({ connectionString: 'postgres://service-host/db' }),
    };
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          name: 'existing-postgres',
          connect_via: 'DATABASE_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });
    mockDb.listServices.mockReturnValue([reusableService]);

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).not.toHaveBeenCalled();
  });

  it('returns project_id from successful deployment', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'proj_abc123',
      projectName: 'test-app',
    });

    const result = await engine.executePlan(plan.plan_id);

    expect(result.project_id).toBe('proj_abc123');
  });

  it('persists error message to database on failure', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'preflight_failed',
      projectId: 'p1',
      projectName: 'test-app',
      preflightError: 'Docker build failed: out of memory',
    });

    await engine.executePlan(plan.plan_id);

    const updateCalls = mockDb.updateDeployPlan.mock.calls;
    const failedCall = updateCalls.find((call: any) => call[1].status === 'failed');
    expect(failedCall[1].errorMessage).toBe('Docker build failed: out of memory');
  });

  it('throws error when executing completed plan', async () => {
    const plan = createMockDeployPlan({
      status: 'completed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Plan status is "completed" — only "ready" plans can be executed.',
    );
  });

  it('throws error when executing failed plan', async () => {
    const plan = createMockDeployPlan({
      status: 'failed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    await expect(engine.executePlan(plan.plan_id)).rejects.toThrow(
      'Plan status is "failed" — only "ready" plans can be executed.',
    );
  });

  it('marks plan completed when compose:up event is received for started project', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'compose',
        dockerfile: 'Dockerfile',
        context: '.',
      },
    });

    const listeners = new Map<string, (payload: unknown) => void>();
    mockEvents.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return vi.fn();
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'compose_project_1',
      projectName: 'test-app',
    });

    await engine.executePlan(plan.plan_id);

    const composeUpHandler = listeners.get('compose:up');
    expect(composeUpHandler).toBeDefined();

    composeUpHandler?.({ projectId: 'compose_project_1', services: ['web'] });

    const completedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
      return call[0] === plan.plan_id && call[1].status === 'completed';
    });

    expect(completedCall).toBeDefined();
  });

  it('marks plan failed with error message when compose:failed event is received', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'compose',
        dockerfile: 'Dockerfile',
        context: '.',
      },
    });

    const listeners = new Map<string, (payload: unknown) => void>();
    mockEvents.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return vi.fn();
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'compose_project_2',
      projectName: 'test-app',
    });

    await engine.executePlan(plan.plan_id);

    const composeFailedHandler = listeners.get('compose:failed');
    expect(composeFailedHandler).toBeDefined();

    composeFailedHandler?.({ projectId: 'compose_project_2', error: 'compose boot failed' });

    const failedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
      return call[0] === plan.plan_id && call[1].status === 'failed';
    });

    expect(failedCall).toBeDefined();
    expect(failedCall[1].errorMessage).toBe('compose boot failed');
  });

  it('keeps deploy:success transition behavior for dockerfile deployments', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
      },
    });

    const listeners = new Map<string, (payload: unknown) => void>();
    mockEvents.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return vi.fn();
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'docker_project_1',
      projectName: 'test-app',
    });

    await engine.executePlan(plan.plan_id);

    const deploySuccessHandler = listeners.get('deploy:success');
    expect(deploySuccessHandler).toBeDefined();

    deploySuccessHandler?.({
      projectId: 'docker_project_1',
      url: 'http://test.local',
      totalDurationMs: 1234,
    });

    const completedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
      return call[0] === plan.plan_id && call[1].status === 'completed';
    });

    expect(completedCall).toBeDefined();
  });

  it('stores targetProjectId on image plans without binding plan.project_id', async () => {
    const plan = await engine.createPlan({
      source: 'image',
      imageUrl: 'nginx:latest',
      name: 'new-worker',
      targetProjectId: 'p1',
    });

    expect(plan.project_id).toBeUndefined();
    expect(plan.target_project_id).toBe('p1');
    expect((plan as { execution?: { targetProjectId?: string } }).execution?.targetProjectId).toBe(
      'p1',
    );
    const createCall = mockDb.createDeployPlan.mock.calls[0][0];
    const storedPlan = JSON.parse(createCall.planJson);
    expect(storedPlan.project_id).toBeUndefined();
    expect(storedPlan.target_project_id).toBe('p1');
    expect(storedPlan.execution.targetProjectId).toBe('p1');
  });

  it('allows target_project_id image plans to use the target Project name', async () => {
    const plan = await engine.createPlan({
      source: 'image',
      imageUrl: 'nginx:latest',
      name: 'test-app',
      targetProjectId: 'p1',
    });

    expect(plan.app.name).toBe('test-app');
    expect(plan.target_project_id).toBe('p1');
    expect(mockDb.createDeployPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'test-app',
      }),
    );
  });

  it('attaches a target_project_id service from the plan event listener after deploy success', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      app: {
        name: 'new-worker',
        source: {
          repo_url: 'https://github.com/test/new-worker',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      execution: { targetProjectId: 'target' },
    });

    const listeners = new Map<string, (payload: { projectId: string; error?: string }) => void>();
    mockEvents.on.mockImplementation(
      (event: string, handler: (payload: { projectId: string; error?: string }) => void) => {
        listeners.set(event, handler);
        return vi.fn();
      },
    );
    mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });
    mockDb.attachServiceToProject.mockResolvedValueOnce({
      sourceProjectId: 'runtime-project',
      targetProjectId: 'target',
      droppedEnvVarKeys: [],
      droppedSecretFiles: [],
    });
    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'runtime-project',
      projectName: 'new-worker',
    });

    const result = await engine.executePlan(plan.plan_id, undefined, 'session-target');

    expect(result).toMatchObject({
      status: 'building',
      project_id: 'runtime-project',
      runtime_project_id: 'runtime-project',
      target_project_id: 'target',
      service_id: 'runtime-project__svc',
    });
    expect(mockDb.acquireDeployLock).toHaveBeenCalledWith('target', 'session-target');
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new-worker',
        _networkProjectName: 'ais-server',
        _lockSessionId: 'session-target',
      }),
    );

    listeners.get('deploy:success')?.({ projectId: 'runtime-project' });

    await vi.waitFor(() =>
      expect(mockDb.attachServiceToProject).toHaveBeenCalledWith('runtime-project__svc', 'target'),
    );
    await vi.waitFor(() => {
      const completedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
        return call[0] === plan.plan_id && call[1].status === 'completed';
      });
      expect(completedCall).toBeDefined();
      const completedPlan = JSON.parse(completedCall[1].planJson);
      expect(completedPlan.project_id).toBe('target');
      expect(completedPlan.target_project_id).toBe('target');
    });
  });

  it('executes target_project_id plan when Application name matches the target Project', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      app: {
        name: 'ais-server',
        source: {
          repo_url: 'https://github.com/test/ais-server',
          branch: 'main',
          commit_sha: 'abc123',
        },
      },
      execution: { targetProjectId: 'target' },
    });

    mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    mockDb.getProjectByName.mockImplementation((name: string) =>
      name === 'ais-server' ? { id: 'target', name: 'ais-server' } : null,
    );
    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });
    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'target',
      projectName: 'ais-server',
    });

    const result = await engine.executePlan(plan.plan_id, undefined, 'session-target');

    expect(result).toMatchObject({
      status: 'building',
      project_id: 'target',
      runtime_project_id: 'target',
      target_project_id: 'target',
      service_id: 'target__svc',
    });
    expect(mockDb.acquireDeployLock).toHaveBeenCalledWith('target', 'session-target');
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ais-server',
        _lockSessionId: 'session-target',
      }),
    );
  });

  it('does not attach target_project_id services when deploy fails', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      execution: { targetProjectId: 'target' },
    });

    const listeners = new Map<string, (payload: { projectId: string; error?: string }) => void>();
    mockEvents.on.mockImplementation(
      (event: string, handler: (payload: { projectId: string; error?: string }) => void) => {
        listeners.set(event, handler);
        return vi.fn();
      },
    );
    mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });
    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'runtime-project',
      projectName: 'test-app',
    });

    await engine.executePlan(plan.plan_id);
    listeners.get('deploy:failed')?.({ projectId: 'runtime-project', error: 'build failed' });

    await vi.waitFor(() => {
      const failedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
        return call[0] === plan.plan_id && call[1].status === 'failed';
      });
      expect(failedCall).toBeDefined();
      expect(failedCall[1].errorMessage).toBe('build failed');
    });
    expect(mockDb.attachServiceToProject).not.toHaveBeenCalled();
  });

  it('marks the deploy plan failed when post-success target attach fails', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
      target_project_id: 'target',
      execution: { targetProjectId: 'target' },
    });

    const listeners = new Map<string, (payload: { projectId: string; error?: string }) => void>();
    mockEvents.on.mockImplementation(
      (event: string, handler: (payload: { projectId: string; error?: string }) => void) => {
        listeners.set(event, handler);
        return vi.fn();
      },
    );
    mockDb.getProject.mockImplementation((id: string) =>
      id === 'target' ? { id: 'target', name: 'ais-server' } : null,
    );
    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });
    mockDb.attachServiceToProject.mockRejectedValueOnce(new Error('attach constraint failed'));
    mockPipeline.startDeploy.mockResolvedValue({
      status: 'building',
      projectId: 'runtime-project',
      projectName: 'test-app',
    });

    await engine.executePlan(plan.plan_id);
    listeners.get('deploy:success')?.({ projectId: 'runtime-project' });

    await vi.waitFor(() => {
      const failedCall = mockDb.updateDeployPlan.mock.calls.find((call: any) => {
        return call[0] === plan.plan_id && call[1].status === 'failed';
      });
      expect(failedCall).toBeDefined();
      expect(failedCall[1].errorMessage).toContain(
        'Deploy succeeded but target attach failed: attach constraint failed',
      );
    });
  });

  it('uses single mode (startDeploy) when dockerfile is non-default, even with multiple dockerfiles found', async () => {
    mockPipeline.startMonorepoDeploy = vi.fn().mockReturnValue({
      parentProjectId: 'mono-1',
      parentName: 'test-app',
      status: 'building',
    });

    const plan = createMockDeployPlan({
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile.api',
        context: '.',
        dockerfiles_found: ['Dockerfile', 'Dockerfile.api', 'apps/Dockerfile'],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalled();
    expect(mockPipeline.startMonorepoDeploy).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        preferDockerfile: true,
        dockerfilePath: 'Dockerfile.api',
      }),
    );
  });

  it('uses monorepo mode when default Dockerfile and multiple dockerfiles found', async () => {
    const { cloneRepo } = await import('../src/pipeline/git.js');
    (cloneRepo as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/tmp/test-clone',
      commitSha: 'mono-sha',
    });

    mockPipeline.startMonorepoDeploy = vi.fn().mockReturnValue({
      parentProjectId: 'mono-1',
      parentName: 'test-app',
      status: 'building',
    });

    const plan = createMockDeployPlan({
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
        dockerfiles_found: ['Dockerfile', 'apps/Dockerfile'],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startMonorepoDeploy).toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  it('propagates the plan lock session into monorepo execution for existing projects', async () => {
    const { cloneRepo } = await import('../src/pipeline/git.js');
    (cloneRepo as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/tmp/test-clone',
      commitSha: 'mono-sha',
    });

    mockPipeline.startMonorepoDeploy = vi.fn().mockReturnValue({
      parentProjectId: 'p1',
      parentName: 'test-app',
      status: 'building',
    });

    const plan = createMockDeployPlan({
      project_id: 'p1',
      build: {
        method: 'dockerfile',
        dockerfile: 'Dockerfile',
        context: '.',
        dockerfiles_found: ['Dockerfile', 'apps/Dockerfile'],
      },
    });

    mockDb.getDeployPlan.mockReturnValue({
      id: plan.plan_id,
      status: 'ready',
      plan_json: JSON.stringify(plan),
    });

    await engine.executePlan(plan.plan_id, undefined, 'plan-session-mono');

    expect(mockDb.acquireDeployLock).toHaveBeenCalledWith('p1', 'plan-session-mono');
    expect(mockPipeline.startMonorepoDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        _lockSessionId: 'plan-session-mono',
      }),
    );
  });
});

// P2 safety: the approval gate on a needs_approval plan. These verify the gate
// fires BEFORE any provisioning, that an unapproved plan creates nothing, that
// approved provisioning is conflict-safe (idempotent), that a lock failure
// never persists 'ready', and that the reuse path backfills a connection row
// only when a real consumer workload exists.
describe('PlanEngine.executePlan — P2 approval gate', () => {
  let engine: PlanEngine;
  let mockDb: any;
  let mockPipeline: any;
  let mockEnv: any;
  let mockServiceManager: any;
  let mockDocker: any;
  let mockEvents: any;

  const SAFE_PG_PROPOSAL = {
    type: 'postgresql' as const,
    action: 'create' as const,
    connect_via: 'DATABASE_URL',
    resolution: 'proposed_project_service' as const,
    approval: 'safe_resource' as const,
    reason: 'pg',
  };

  // A needs_approval plan with one safe proposed postgresql managed resource.
  // Proposed (action:'create') services carry no name, so the approval
  // identifier is the service type, 'postgresql'.
  const createNeedsApprovalPlan = (overrides?: Record<string, unknown>) =>
    createMockDeployPlan({
      status: 'needs_approval',
      project_id: 'p1',
      services: [SAFE_PG_PROPOSAL],
      env: {
        auto: {},
        required: [],
        provided: {},
        detected: [],
      },
      ...overrides,
    });

  beforeEach(() => {
    mockDb = {
      createDeployPlan: vi.fn(),
      getDeployPlan: vi.fn(),
      updateDeployPlan: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockReturnValue([]),
      getProject: vi.fn((id: string) => (id === 'p1' ? { id: 'p1', name: 'test-app' } : null)),
      getProjectByName: vi.fn().mockReturnValue(null),
      getService: vi.fn().mockReturnValue(null),
      getLastDeployLog: vi.fn().mockReturnValue(null),
      attachServiceToProject: vi.fn().mockResolvedValue({
        sourceProjectId: 'p1',
        targetProjectId: 'p1',
        droppedEnvVarKeys: [],
        droppedSecretFiles: [],
      }),
      // Mimics service-connection.repo onConflictDoNothing: a repeat upsert is a
      // no-op that never throws a unique-violation.
      upsertServiceConnection: vi.fn().mockResolvedValue(undefined),
      getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
      listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
      getDeployableForProject: vi.fn().mockResolvedValue(null),
      // Deploy-time provisioning may run before the app deployable exists. With
      // no real workload consumer yet, FK-bearing connection/dependency rows are
      // deferred while project-scoped env injection still runs.
      getDeployablesByGroup: vi.fn().mockResolvedValue([]),
      createProjectDependency: vi.fn().mockResolvedValue(undefined),
      acquireDeployLock: vi.fn().mockResolvedValue(true),
      getDeployLockInfo: vi.fn().mockResolvedValue(null),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      recordDeployPlanApproval: vi.fn().mockResolvedValue('audit-run-1'),
    };

    mockPipeline = {
      startDeploy: vi
        .fn()
        .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockServiceManager = {
      create: vi.fn().mockResolvedValue({
        id: 'svc-pg-1',
        name: 'test-app-postgresql',
        kind: 'postgres',
        container_name: 'ol-svc-test-app-postgresql',
      }),
      getSuggestedEnv: vi
        .fn()
        .mockResolvedValue([{ key: 'DATABASE_URL', value: 'postgres://provisioned/db' }]),
    };

    mockDocker = {
      ensureProjectNetwork: vi.fn().mockResolvedValue('ol-test-app-net'),
    };

    mockEvents = {
      emit: vi.fn(),
      on: vi.fn(() => vi.fn()),
    };

    const deps: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: {},
      config: {},
      events: mockEvents,
      docker: mockDocker,
    } as unknown as PlanEngineDeps;

    engine = new PlanEngine(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  type DeferredRuntimeEnvFactory = () => Promise<{
    ok: boolean;
    envVars?: Record<string, string>;
  }>;

  const getLastDeferredRuntimeEnvVars = (): DeferredRuntimeEnvFactory => {
    const startDeployCall = mockPipeline.startDeploy.mock.calls.at(-1);
    expect(startDeployCall).toBeDefined();
    const deployConfig = startDeployCall![0] as {
      _deferredRuntimeEnvVars?: DeferredRuntimeEnvFactory;
    };
    expect(deployConfig._deferredRuntimeEnvVars).toEqual(expect.any(Function));
    return deployConfig._deferredRuntimeEnvVars!;
  };

  // (c) Gate fires before provisioning when no approval is supplied.
  it('returns a structured needs_approval result (no throw) and never enters the provisioning loop when unapproved', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('needs_approval');
    expect(result.approval_required).toEqual({ create_resources: ['postgresql'] });
    expect(result._agent_guidance).toBeDefined();
    // Loop not entered: no managed service created, no deploy started.
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
    // No approval was granted, so nothing is written to the approval ledger.
    expect(mockDb.recordDeployPlanApproval).not.toHaveBeenCalled();
  });

  // (d) Zero-provisioning safety: an unapproved plan creates nothing — zero
  // services and zero connection rows.
  it('creates zero services and zero connection rows when an unapproved needs_approval plan is executed', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).toHaveBeenCalledTimes(0);
    expect(mockDb.upsertServiceConnection).toHaveBeenCalledTimes(0);
    expect(mockDb.attachServiceToProject).toHaveBeenCalledTimes(0);
  });

  // (d2) Partial approval is all-or-fail-fast: approving a subset of the safe
  // proposed resources does NOT clear the gate. The plan provisions nothing.
  it('does not approve and provisions nothing when only some safe proposed resources are approved', async () => {
    const SAFE_REDIS_PROPOSAL = {
      type: 'redis' as const,
      action: 'create' as const,
      connect_via: 'REDIS_URL',
      resolution: 'proposed_project_service' as const,
      approval: 'safe_resource' as const,
      reason: 'cache',
    };
    const plan = createNeedsApprovalPlan({
      services: [SAFE_PG_PROPOSAL, SAFE_REDIS_PROPOSAL],
    });
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    // Approve only postgresql, leaving redis unapproved.
    const result = await engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      createResources: ['postgresql'],
    });

    expect(result.status).toBe('needs_approval');
    expect(result.approval_required).toEqual({ create_resources: ['postgresql', 'redis'] });
    // All-or-fail-fast: a partial approval provisions nothing.
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockDb.attachServiceToProject).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  // (d3) New-app guard: an approved create has no target project to provision on
  // for a brand-new app (no project_id, no project row by name). Execute returns
  // 'needs_target_project' and creates NOTHING — no lock, no provisioning, no
  // deploy. 'needs_target_project' is a response-only status.
  it('returns needs_target_project and creates nothing when an approved new-app plan has no existing project', async () => {
    // No project_id, and getProjectByName returns null (default) → new app.
    const plan = createNeedsApprovalPlan({ project_id: undefined });
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    mockDb.getProjectByName.mockReturnValue(null);

    const result = await engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('needs_target_project');
    expect(result.approval_required).toEqual({ create_resources: ['postgresql'] });
    expect(result._agent_guidance).toBeDefined();
    expect(result._agent_guidance?.next_steps.join('\n')).toContain('create_project');
    // Nothing created: no managed service, no connection row, no deploy, and the
    // status was never persisted (no executing write).
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockDb.upsertServiceConnection).not.toHaveBeenCalled();
    expect(mockDb.attachServiceToProject).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
    const wroteExecuting = mockDb.updateDeployPlan.mock.calls.some(
      (call: any) => call[1]?.status === 'executing',
    );
    expect(wroteExecuting).toBe(false);
    // Approval is audited only once execution commits; a blocked new-app plan
    // records nothing.
    expect(mockDb.recordDeployPlanApproval).not.toHaveBeenCalled();
  });

  it('uses plan.project_id as the lock target even when the project name lookup is empty', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    mockDb.getProjectByName.mockReturnValue(null);

    const result = await engine.executePlan(plan.plan_id, undefined, 'session-1', undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('building');
    expect(mockDb.acquireDeployLock).toHaveBeenCalledWith('p1', 'session-1');
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    await getLastDeferredRuntimeEnvVars()();
    expect(mockServiceManager.create).toHaveBeenCalledTimes(1);
    expect(mockDb.upsertServiceConnection).not.toHaveBeenCalled();
  });

  // (e) Idempotency: when the target project already has a real workload,
  // approved provisioning upserts a connection row, and a repeat
  // (onConflictDoNothing) never throws.
  it('upserts a connection row on approved provisioning when a real workload exists and is conflict-safe when provisioned twice', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    mockDb.getDeployablesByGroup.mockResolvedValue([{ id: 'p1__svc' }]);

    const first = await engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(first.status).toBe('building');
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    await getLastDeferredRuntimeEnvVars()();
    expect(mockServiceManager.create).toHaveBeenCalledTimes(1);
    expect(mockDb.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: 'svc-pg-1',
      consumerServiceId: 'p1__svc',
    });

    // Re-running the same approved provisioning path must not throw — the
    // connection upsert is idempotent (onConflictDoNothing semantics).
    const second = await engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(second.status).toBe('building');
    await getLastDeferredRuntimeEnvVars()();
    expect(mockServiceManager.create).toHaveBeenCalledTimes(2);
    expect(mockDb.upsertServiceConnection).toHaveBeenCalledTimes(2);
    expect(mockDb.upsertServiceConnection.mock.results.every((r: any) => r.type === 'return')).toBe(
      true,
    );
  });

  // (e2) Durable approval audit: an approved needs_approval plan whose
  // provisioning is committed records a terminal entry in the action_runs
  // approval ledger (approval_tool='deploy_plan'), making deploy-plan approvals
  // as observable as destructive_mcp ones.
  it('records a durable deploy-plan approval audit entry when approved provisioning proceeds', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });

    const result = await engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
      approveAllSafeResources: true,
    });

    expect(result.status).toBe('building');
    expect(mockDb.recordDeployPlanApproval).toHaveBeenCalledTimes(1);
    const arg = mockDb.recordDeployPlanApproval.mock.calls[0][0];
    expect(arg.projectId).toBe('p1');
    expect(arg.correlationId).toBe(plan.plan_id);
    expect(JSON.parse(arg.plan)).toEqual({
      plan_id: plan.plan_id,
      approved_resources: ['postgresql'],
    });
  });

  // (f) Crash-window: with a valid approval, force the deploy lock to fail. The
  // lock is acquired AFTER the in-memory ready flip but BEFORE the persisted
  // 'executing' write, so a lock failure must leave the persisted status at
  // 'needs_approval' — no updateDeployPlan call ever writes 'ready' (or
  // 'executing').
  it('never persists status ready when the deploy lock throws after approval', async () => {
    const plan = createNeedsApprovalPlan();
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    // An existing project means the engine acquires the deploy lock; make the
    // acquire fail so acquireDeployLockOrThrow throws DeployLockedError.
    mockDb.getProjectByName.mockReturnValue({ id: 'p1', name: 'test-app' });
    mockDb.acquireDeployLock.mockResolvedValue(false);
    mockDb.getDeployLockInfo.mockResolvedValue({ session: 'someone-else' });

    await expect(
      engine.executePlan(plan.plan_id, undefined, undefined, undefined, {
        approveAllSafeResources: true,
      }),
    ).rejects.toThrow();

    // The only persisted pre-deploy status would have been 'executing', which
    // never happens because the lock threw first. Crucially, 'ready' is never
    // persisted (the approval -> ready flip is in-memory only).
    const wroteReady = mockDb.updateDeployPlan.mock.calls.some(
      (call: any) => call[1]?.status === 'ready',
    );
    const wroteExecuting = mockDb.updateDeployPlan.mock.calls.some(
      (call: any) => call[1]?.status === 'executing',
    );
    expect(wroteReady).toBe(false);
    expect(wroteExecuting).toBe(false);
    // Nothing was provisioned either — the lock guards provisioning.
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    // The lock fails before execution commits, so no approval is audited.
    expect(mockDb.recordDeployPlanApproval).not.toHaveBeenCalled();
  });

  // (g) Reuse path backfill: an existing reusable managed service upserts a
  // connection row for the reuse provider.
  it('upserts a connection row for the reuse provider on the existing_project_service path', async () => {
    const reusableService = {
      id: 'reuse-pg-1',
      name: 'existing-postgres',
      project_id: 'p1',
      kind: 'postgres',
      credentials: JSON.stringify({ connectionString: 'postgres://reused-host/db' }),
    };
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          service_id: reusableService.id,
          name: reusableService.name,
          connect_via: 'DATABASE_URL',
          resolution: 'existing_project_service',
          approval: 'safe_resource',
          reason: 'pg',
        },
      ],
      env: {
        auto: {},
        required: [],
        provided: {},
        detected: [],
      },
    });
    mockDb.getDeployPlan.mockReturnValue({ plan_json: JSON.stringify(plan) });
    mockDb.getService.mockReturnValue(reusableService);
    mockDb.listServices.mockReturnValue([reusableService]);
    mockDb.getDeployablesByGroup.mockResolvedValue([{ id: 'p1__svc' }]);

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('building');
    expect(mockDb.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: reusableService.id,
      consumerServiceId: 'p1__svc',
    });
    // Reuse never creates a managed service.
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    // The reused connection string is injected into the deploy env.
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({ DATABASE_URL: 'postgres://reused-host/db' }),
      }),
    );
  });
});
