import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn((...args: Parameters<typeof actual.existsSync>) =>
      actual.existsSync(...args),
    ),
    readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
      actual.readFileSync(...args),
    ),
  };
});

import { PlanEngine } from '../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../src/pipeline/deploy-plan/engine.js';
import { cloneRepo } from '../src/pipeline/git.js';
import * as infraAnalyzer from '../src/lib/infra-analyzer.js';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('PlanEngine.createPlan', () => {
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

    mockCloneRepo.mockReset();
    mockAnalyzeInfra.mockReset();
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockAnalyzeInfra.mockRestore();
  });

  it('creates a simple plan when Dockerfile exists and no infra needs', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'abc123def456',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/simple-app',
      branch: 'main',
    });

    expect(plan.complexity).toBe('simple');
    expect(plan.status).toBe('ready');
    expect(plan.missing).toHaveLength(0);
    expect(plan.services).toHaveLength(0);
    expect(plan.app.name).toBe('simple-app');
    expect(plan.app.source.commit_sha).toBe('abc123def456');
  });

  it('persists plan to database with correct fields', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'persist123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    await engine.createPlan({
      repoUrl: 'https://github.com/test/persist-app',
      branch: 'main',
    });

    expect(mockDb.createDeployPlan).toHaveBeenCalled();
    const call = mockDb.createDeployPlan.mock.calls[0][0];
    expect(call.id).toMatch(/^plan_/);
    expect(call.status).toBe('ready');
    expect(call.commitSha).toBe('persist123');
    expect(call.projectName).toBe('persist-app');
  });

  it('captures commit SHA from clone result', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'abc123def456ghi789',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/sha-app',
      branch: 'main',
    });

    expect(plan.app.source.commit_sha).toBe('abc123def456ghi789');
  });

  it('generates plan_id with plan_ prefix', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'test123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/id-app',
      branch: 'main',
    });

    expect(plan.plan_id).toMatch(/^plan_[a-zA-Z0-9_-]{12}$/);
  });

  it('adds warning when Dockerfile is missing', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'nodoc123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/nodoc-app',
      branch: 'main',
    });

    expect(plan.warnings).toContain('No Dockerfile found; will auto-generate one during build');
    expect(plan.build.generated_dockerfile).toBe('auto-generated');
  });

  it('extracts project name from repo URL', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'name123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/user/my-awesome-app',
      branch: 'main',
    });

    expect(plan.app.name).toBe('my-awesome-app');
  });

  it('uses provided name over extracted name', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'custom123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/user/repo',
      branch: 'main',
      name: 'custom-name',
    });

    expect(plan.app.name).toBe('custom-name');
  });

  it('marks plan as needs_input when env vars are missing', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'plan-env-app-'));
    writeFileSync(join(repoPath, '.env.example'), 'API_KEY=\nSECRET_TOKEN=\n');
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');

    mockCloneRepo.mockResolvedValue({
      path: repoPath,
      commitSha: 'xyz789',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    mockReadFileSync.mockImplementation(actualFs.readFileSync);

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/env-app',
      branch: 'main',
    });

    expect(plan.status).toBe('needs_input');
    expect(plan.missing).toContain('API_KEY');
    expect(plan.missing.length).toBeGreaterThanOrEqual(1);

    rmSync(repoPath, { recursive: true, force: true });
  });

  it('detects postgresql dependency and creates service', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'def789ghi012',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [],
      missing: [{ type: 'postgresql', suggestion: 'Create a postgresql service' }],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/pg-app',
      branch: 'main',
    });

    expect(plan.services).toHaveLength(1);
    expect(plan.services[0].type).toBe('postgresql');
    expect(plan.services[0].action).toBe('create');
    expect(plan.services[0].connect_via).toBe('DATABASE_URL');
    expect(plan.status).toBe('ready');
  });

  it('skips compose detection when dockerfilePath is explicitly provided', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [{ name: 'web', build: '.', ports: ['3000:3000'] }],
      }),
    };

    const depsWithCompose: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: mockComposePipeline as unknown as PlanEngineDeps['composePipeline'],
    };
    const engineWithCompose = new PlanEngine(depsWithCompose);

    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'dockerfile-path-test',
    });

    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/monorepo',
      branch: 'main',
      dockerfilePath: 'backend/Dockerfile',
    });

    expect(plan.build.method).toBe('dockerfile');
    expect(plan.build.dockerfile).toBe('backend/Dockerfile');
    expect(plan.build.context).toBe('backend');
    expect(mockComposePipeline.detectComposeFile).not.toHaveBeenCalled();
  });

  it('uses compose when no dockerfilePath and compose file exists', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [{ name: 'web', build: '.', ports: ['3000:3000'] }],
      }),
    };

    const depsWithCompose: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: mockComposePipeline as unknown as PlanEngineDeps['composePipeline'],
    };
    const engineWithCompose = new PlanEngine(depsWithCompose);

    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'compose-test',
    });

    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/compose-app',
      branch: 'main',
    });

    expect(plan.build.method).toBe('compose');
    expect(plan.build.compose_services?.[0]?.host_ports).toEqual(['3000:3000']);
    expect(mockComposePipeline.detectComposeFile).toHaveBeenCalled();
  });

  it('skips compose detection when preferDockerfile is true (even without dockerfilePath)', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn(),
    };

    const depsWithCompose: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: mockComposePipeline as unknown as PlanEngineDeps['composePipeline'],
    };
    const engineWithCompose = new PlanEngine(depsWithCompose);

    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'prefer-df-test',
    });

    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/prefer-app',
      branch: 'main',
      preferDockerfile: true,
    });

    expect(plan.build.method).toBe('dockerfile');
    expect(mockComposePipeline.detectComposeFile).not.toHaveBeenCalled();
  });

  it('classifies complexity as complex with 2+ services and missing env vars', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'plan-complex-app-'));
    writeFileSync(join(repoPath, '.env.example'), 'API_KEY=\n');
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');

    mockCloneRepo.mockResolvedValue({
      path: repoPath,
      commitSha: 'complex123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [
        { type: 'postgresql', detectedFrom: 'pg' },
        { type: 'redis', detectedFrom: 'redis' },
      ],
      available: [],
      missing: [
        { type: 'postgresql', suggestion: 'Create postgresql' },
        { type: 'redis', suggestion: 'Create redis' },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    mockReadFileSync.mockImplementation(actualFs.readFileSync);

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/complex-app',
      branch: 'main',
    });

    expect(plan.complexity).toBe('complex');
    expect(plan.services).toHaveLength(2);
    expect(plan.missing).toContain('API_KEY');

    rmSync(repoPath, { recursive: true, force: true });
  });
});
