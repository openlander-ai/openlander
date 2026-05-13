import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

import { PlanEngine } from '../../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../../src/pipeline/deploy-plan/engine.js';
import { cloneRepo } from '../../src/pipeline/git.js';
import { createMockDeployPlan } from '../helpers/deploy-plan-mocks.js';
import * as infraAnalyzer from '../../src/lib/infra-analyzer.js';
import { createDeployPlanSchema, deploySchema, setEnvVarsSchema } from '../../src/tools/defs/schemas.js';

const mockCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;

function createEngine() {
  const mockDb = {
    createDeployPlan: vi.fn(),
    getDeployPlan: vi.fn(),
    updateDeployPlan: vi.fn(),
    listServices: vi.fn().mockResolvedValue([]),
    getProjectByName: vi.fn().mockResolvedValue(null),
    getLastDeployLog: vi.fn().mockResolvedValue(null),
  };
  const mockPipeline = {
    startDeploy: vi
      .fn()
      .mockResolvedValue({ status: 'building', projectId: 'p1', projectName: 'test-app' }),
  };
  const mockEnv = {
    getAll: vi.fn().mockResolvedValue({}),
    getGlobalSecrets: vi.fn().mockResolvedValue({}),
  };
  const mockServiceManager = {
    create: vi.fn().mockResolvedValue({
      credentials: JSON.stringify({ connectionString: 'postgres://managed/db' }),
    }),
  };
  const mockEvents = {
    on: vi.fn(() => vi.fn()),
  };

  const engine = new PlanEngine({
    db: mockDb,
    pipeline: mockPipeline,
    env: mockEnv,
    serviceManager: mockServiceManager,
    autoDetector: {},
    config: {},
    events: mockEvents,
  } as unknown as PlanEngineDeps);

  return { engine, mockDb, mockPipeline, mockServiceManager };
}

describe('MCP agent UX rc6 regressions', () => {
  let repoPath: string;
  let analyzeInfrastructureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'openlander-rc6-agent-ux-'));
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');
    mockCloneRepo.mockResolvedValue({ path: repoPath, commitSha: 'rc6abc' });
    analyzeInfrastructureSpy = vi.spyOn(infraAnalyzer, 'analyzeInfrastructure').mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [],
      missing: [{ type: 'postgresql', suggestion: 'Create a postgresql service' }],
    });
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    mockCloneRepo.mockReset();
    analyzeInfrastructureSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('keeps explicit DATABASE_URL authoritative during one-call plan creation', async () => {
    const { engine } = createEngine();

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/example/app',
      branch: 'main',
      envVars: { DATABASE_URL: 'mysql://external.example.com/app' },
    });

    expect(plan.services).toEqual([]);
    expect(plan.env.auto).toEqual({});
    expect(plan.env.provided).toEqual({ DATABASE_URL: 'mysql://external.example.com/app' });
    expect(plan.warnings.join('\n')).toContain('skipping automatic managed service provisioning');
  });

  it('removes pending auto services when update_deploy_plan provides the env var', async () => {
    const { engine, mockDb } = createEngine();
    const plan = createMockDeployPlan({
      status: 'needs_input',
      services: [{ type: 'postgresql', action: 'create', connect_via: 'DATABASE_URL' }],
      env: {
        auto: { DATABASE_URL: 'postgresql://localhost' },
        required: ['DATABASE_URL'],
        provided: {},
        detected: [{ key: 'DATABASE_URL', source: 'source', required: true }],
      },
      missing: ['DATABASE_URL'],
    });
    mockDb.getDeployPlan.mockResolvedValue({ plan_json: JSON.stringify(plan) });

    const updated = await engine.updatePlan(plan.plan_id, {
      env: { DATABASE_URL: 'mysql://external.example.com/app' },
    });

    expect(updated.status).toBe('ready');
    expect(updated.services).toEqual([]);
    expect(updated.env.auto).toEqual({});
    expect(updated.env.provided).toEqual({ DATABASE_URL: 'mysql://external.example.com/app' });
  });

  it('does not create a managed service or overwrite explicit env on legacy plans', async () => {
    const { engine, mockDb, mockPipeline, mockServiceManager } = createEngine();
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [{ type: 'postgresql', action: 'create', connect_via: 'DATABASE_URL' }],
      env: {
        auto: { DATABASE_URL: 'postgresql://localhost' },
        required: ['DATABASE_URL'],
        provided: { DATABASE_URL: 'mysql://external.example.com/app' },
        detected: [{ key: 'DATABASE_URL', source: 'source', required: true }],
      },
      missing: [],
    });
    mockDb.getDeployPlan.mockResolvedValue({ plan_json: JSON.stringify(plan) });

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          DATABASE_URL: 'mysql://external.example.com/app',
        }),
      }),
    );
  });

  it('accepts object-shaped env vars in MCP schemas', () => {
    expect(
      createDeployPlanSchema.safeParse({
        repo_url: 'https://github.com/example/app',
        env_vars: { DATABASE_URL: 'mysql://external.example.com/app' },
      }).success,
    ).toBe(true);
    expect(
      deploySchema.safeParse({
        repo_url: 'https://github.com/example/app',
        env_vars: { API_KEY: 'secret' },
      }).success,
    ).toBe(true);
    expect(
      setEnvVarsSchema.safeParse({
        service_id: 'app__svc',
        variables: { API_KEY: 'secret' },
      }).success,
    ).toBe(true);
  });
});
