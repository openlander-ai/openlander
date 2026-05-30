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
import {
  createDeployPlanSchema,
  deploySchema,
  setEnvVarsSchema,
} from '../../src/tools/defs/schemas.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';

const mockCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;

function createEngine() {
  const mockDb = {
    createDeployPlan: vi.fn(),
    getDeployPlan: vi.fn(),
    updateDeployPlan: vi.fn().mockResolvedValue(undefined),
    listServices: vi.fn().mockResolvedValue([]),
    getProject: vi.fn((id: string) => (id === 'p1' ? { id: 'p1', name: 'test-app' } : null)),
    getProjectByName: vi.fn().mockResolvedValue(null),
    getLastDeployLog: vi.fn().mockResolvedValue(null),
    getService: vi.fn().mockResolvedValue(undefined),
    acquireDeployLock: vi.fn().mockResolvedValue(true),
    releaseDeployLock: vi.fn().mockResolvedValue(undefined),
    getDeployLockInfo: vi.fn().mockResolvedValue(null),
    upsertServiceConnection: vi.fn().mockResolvedValue(undefined),
    attachServiceToProject: vi.fn().mockResolvedValue({
      sourceProjectId: 'orphan',
      targetProjectId: 'p1',
      droppedEnvVarKeys: [],
      droppedSecretFiles: [],
    }),
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

function getDeployPlanTool(name: string) {
  const tool = deployPlanToolDefs.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function getEnvTool(name: string) {
  const tool = envToolDefs.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

function createEnvToolContext() {
  const project = { id: 'p1', name: 'my-app', status: 'running' };
  const service = {
    id: 'my-app__svc',
    name: 'web',
    project_id: 'p1',
    kind: 'git',
    source: 'git',
    status: 'running',
  };
  const db = {
    getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
    getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
    getDeployablesByGroup: vi.fn().mockResolvedValue([service]),
    listServices: vi.fn().mockResolvedValue([service]),
    assertEnvToolSchemaReady: vi.fn().mockResolvedValue(undefined),
  };
  const env = {
    setBulkForServiceDetailed: vi.fn().mockResolvedValue([]),
    verifyRoundTripForService: vi.fn().mockResolvedValue([]),
  };
  return { db, env, pipeline: { redeploy: vi.fn() } };
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
        auto: {},
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

  it('surfaces needs_approval for detected managed services without localhost placeholders', async () => {
    const { engine } = createEngine();

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/example/app',
      branch: 'main',
    });

    // Proposed safe managed resource is auto-provisionable on approval, so its
    // DATABASE_URL is not "missing" and the plan surfaces as needs_approval.
    expect(plan.status).toBe('needs_approval');
    expect(plan.missing).toEqual([]);
    expect(plan.env.auto).toEqual({});
    expect(plan.services).toEqual([
      expect.objectContaining({
        type: 'postgresql',
        action: 'create',
        connect_via: 'DATABASE_URL',
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('postgresql://localhost');
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

  it('rejects implicit managed service creation during execute_deploy_plan', async () => {
    const { engine, mockDb, mockPipeline, mockServiceManager } = createEngine();
    const plan = createMockDeployPlan({
      status: 'ready',
      services: [{ type: 'postgresql', action: 'create', connect_via: 'DATABASE_URL' }],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [{ key: 'DATABASE_URL', source: 'source', required: true }],
      },
      missing: [],
    });
    mockDb.getDeployPlan.mockResolvedValue({ plan_json: JSON.stringify(plan) });

    const result = await engine.executePlan(plan.plan_id);

    expect(result).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('requires an explicit DATABASE_URL value'),
    });
    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).not.toHaveBeenCalled();
  });

  it('injects reused managed service credentials during execute_deploy_plan', async () => {
    const { engine, mockDb, mockPipeline, mockServiceManager } = createEngine();
    const plan = createMockDeployPlan({
      status: 'ready',
      project_id: 'p1',
      services: [
        {
          type: 'postgresql',
          action: 'reuse',
          service_id: 'svc-pg',
          connect_via: 'DATABASE_URL',
        },
      ],
      env: {
        auto: {},
        required: ['DATABASE_URL'],
        provided: {},
        detected: [{ key: 'DATABASE_URL', source: 'source', required: true }],
      },
      missing: [],
    });
    mockDb.getDeployPlan.mockResolvedValue({ plan_json: JSON.stringify(plan) });
    mockDb.getService.mockResolvedValue({
      id: 'svc-pg',
      project_id: 'p1',
      kind: 'postgres',
      credentials: JSON.stringify({ connectionString: 'postgres://reused/db' }),
    });

    await engine.executePlan(plan.plan_id);

    expect(mockServiceManager.create).not.toHaveBeenCalled();
    expect(mockPipeline.startDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        envVars: expect.objectContaining({
          DATABASE_URL: 'postgres://reused/db',
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

  it('explains image deploys that omit source="image"', () => {
    const createPlanResult = createDeployPlanSchema.safeParse({
      name: 'image-demo',
      image: 'nginx:alpine',
    });
    const deployAppResult = deploySchema.safeParse({
      name: 'image-demo',
      image: 'nginx:alpine',
    });

    for (const result of [createPlanResult, deployAppResult]) {
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['source'],
              message: expect.stringContaining('source must be set to "image"'),
            }),
          ]),
        );
      }
    }
  });

  it('accepts project group name as service_name for env tools when unambiguous', async () => {
    const { db, env, pipeline } = createEnvToolContext();

    const result = (await getEnvTool('set_env_vars').execute(
      { service_name: 'my-app', variables: { API_KEY: 'secret' } },
      { appCtx: { db, env, pipeline }, target: 'mcp' },
    )) as Record<string, unknown>;

    expect(env.setBulkForServiceDetailed).toHaveBeenCalledWith('p1', 'my-app__svc', {
      API_KEY: 'secret',
    });
    expect(result).toMatchObject({
      status: 'updated',
      project: 'my-app',
      service: 'web',
    });
  });

  it('rejects malformed JSON env var strings with BAD_REQUEST', async () => {
    const { engine } = createEngine();
    await expect(
      getDeployPlanTool('create_deploy_plan').execute(
        { repo_url: 'https://github.com/example/app', env_vars: '{bad json' },
        { appCtx: { planEngine: engine }, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
  });

  it('rejects non-object env var inputs with BAD_REQUEST', async () => {
    const { db, env, pipeline } = createEnvToolContext();
    await expect(
      getEnvTool('set_env_vars').execute(
        { project_name: 'my-app', variables: 'false' },
        { appCtx: { db, env, pipeline }, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', statusCode: 400 });
  });

  it('rejects non-string env var object values with BAD_REQUEST details', async () => {
    const { engine } = createEngine();
    await expect(
      getDeployPlanTool('deploy_app').execute(
        { repo_url: 'https://github.com/example/app', env_vars: { DATABASE_URL: 123 } },
        { appCtx: { planEngine: engine }, target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      details: { key: 'DATABASE_URL' },
    });
  });
});
