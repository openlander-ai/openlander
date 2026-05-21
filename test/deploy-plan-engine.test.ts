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
    };

    mockPipeline = {
      startDeploy: vi
        .fn()
        .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
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
});
