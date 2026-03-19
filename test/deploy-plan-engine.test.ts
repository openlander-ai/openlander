import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

vi.mock('../src/lib/infra-analyzer.js', () => ({
  analyzeInfrastructure: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { PlanEngine } from '../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../src/pipeline/deploy-plan/engine.js';
import { createMockDeployPlan } from './helpers/deploy-plan-mocks.js';

describe('PlanEngine.updatePlan', () => {
  let engine: PlanEngine;
  let mockDb: any;
  let mockPipeline: any;
  let mockEnv: any;
  let mockServiceManager: any;
  let mockAutoDetector: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDb = {
      createDeployPlan: vi.fn(),
      getDeployPlan: vi.fn(),
      updateDeployPlan: vi.fn(),
      listServices: vi.fn().mockReturnValue([]),
    };

    mockPipeline = {
      deploy: vi.fn().mockResolvedValue({ success: true, projectId: 'p1' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
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
  });

  it('fills missing env var with flat format { env: { DATABASE_URL: "postgres://..." } }', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
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

  it('fills missing env var with structured format { env: { provided: { DATABASE_URL: "..." } } }', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
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

  it('throws error when updating plan in executing status', () => {
    const plan = createMockDeployPlan({
      status: 'executing',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    expect(() => {
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      });
    }).toThrow('Cannot update plan in executing status');
  });

  it('throws error when updating plan in completed status', () => {
    const plan = createMockDeployPlan({
      status: 'completed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    expect(() => {
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      });
    }).toThrow('Cannot update plan in completed status');
  });

  it('preserves unchanged fields during partial update', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.app.name).toBe('my-app');
    expect(updated.app.source.repo_url).toBe('https://github.com/test/repo');
    expect(updated.build.dockerfile).toBe('Dockerfile');
    expect(updated.build.context).toBe('.');
  });

  it('handles invalid JSON in updates gracefully', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.status).toBe('ready');
    expect(updated.env.provided.DATABASE_URL).toBe('postgres://localhost/db');
  });

  it('throws error when plan not found', () => {
    mockDb.getDeployPlan.mockReturnValue(null);

    expect(() => {
      engine.updatePlan('plan_nonexistent', {
        env: { TEST_VAR: 'value' },
      });
    }).toThrow('Deploy plan not found: plan_nonexistent');
  });

  it('persists updated plan to database', () => {
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

    engine.updatePlan(plan.plan_id, {
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

  it('updates multiple env vars at once', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
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

  it('merges env vars with existing provided vars', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'postgres://localhost/db' },
    });

    expect(updated.env.provided).toEqual({
      API_KEY: 'existing_key',
      DATABASE_URL: 'postgres://localhost/db',
    });
    expect(updated.missing).toHaveLength(0);
  });

  it('updates build configuration', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
      build: {
        context: './app',
        target: 'production',
      },
    });

    expect(updated.build.context).toBe('./app');
    expect(updated.build.target).toBe('production');
    expect(updated.build.dockerfile).toBe('Dockerfile');
  });

  it('updates health check configuration', () => {
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

    const updated = engine.updatePlan(plan.plan_id, {
      health: {
        path: '/health',
        retries: 5,
      },
    });

    expect(updated.health.path).toBe('/health');
    expect(updated.health.retries).toBe(5);
    expect(updated.health.interval_ms).toBe(2000);
  });

  it('throws error when updating plan in failed status', () => {
    const plan = createMockDeployPlan({
      status: 'failed',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    expect(() => {
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      });
    }).toThrow('Cannot update plan in failed status');
  });

  it('throws error when updating plan in rolled_back status', () => {
    const plan = createMockDeployPlan({
      status: 'rolled_back',
    });

    mockDb.getDeployPlan.mockReturnValue({
      plan_json: JSON.stringify(plan),
    });

    expect(() => {
      engine.updatePlan(plan.plan_id, {
        env: { TEST_VAR: 'value' },
      });
    }).toThrow('Cannot update plan in rolled_back status');
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
      updateDeployPlan: vi.fn(),
      listServices: vi.fn().mockReturnValue([]),
      getProjectByName: vi.fn().mockReturnValue(null),
      getLastDeployLog: vi.fn().mockReturnValue(null),
    };

    mockPipeline = {
      startDeploy: vi
        .fn()
        .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
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
      'Plan is already executing. Cannot execute concurrently.',
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
      'Plan is already needs_input. Cannot execute concurrently.',
    );
  });

  it('calls serviceManager.create with correct template for service provisioning', async () => {
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

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).toHaveBeenCalledWith({
      name: expect.stringMatching(/^postgresql-\d+$/),
      template: 'postgresql',
    });
  });

  it('injects service credentials into environment variables', async () => {
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

    mockServiceManager.create.mockResolvedValue({
      credentials: JSON.stringify({ connectionString: 'postgres://service-host/db' }),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          DATABASE_URL: 'postgres://service-host/db',
        }),
      }),
    );
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

  it('handles service creation failure gracefully', async () => {
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

    mockServiceManager.create.mockRejectedValue(new Error('Service creation failed'));

    const result = await engine.executePlan(plan.plan_id);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Service creation failed');
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

  it('handles multiple services with different types', async () => {
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

    mockServiceManager.create.mockResolvedValue({
      credentials: JSON.stringify({ connectionString: 'service://localhost' }),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).toHaveBeenCalledTimes(2);
    expect(mockServiceManager.create).toHaveBeenNthCalledWith(1, {
      name: expect.stringMatching(/^postgresql-\d+$/),
      template: 'postgresql',
    });
    expect(mockServiceManager.create).toHaveBeenNthCalledWith(2, {
      name: expect.stringMatching(/^redis-\d+$/),
      template: 'redis',
    });
  });

  it('skips service creation for reuse action', async () => {
    const plan = createMockDeployPlan({
      status: 'ready',
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
      'Plan is already completed. Cannot execute concurrently.',
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
      'Plan is already failed. Cannot execute concurrently.',
    );
  });
});
