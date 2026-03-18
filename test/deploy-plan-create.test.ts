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
import { cloneRepo } from '../src/pipeline/git.js';
import { analyzeInfrastructure } from '../src/lib/infra-analyzer.js';
import { existsSync, readFileSync } from 'node:fs';

const mockCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;
const mockAnalyzeInfra = analyzeInfrastructure as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

describe('PlanEngine.createPlan', () => {
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
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
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
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'xyz789',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('.env')) {
        return 'API_KEY=\nSECRET_TOKEN=\n';
      }
      return '';
    });

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/env-app',
      branch: 'main',
    });

    expect(plan.status).toBe('needs_input');
    expect(plan.missing).toContain('API_KEY');
    expect(plan.missing).toContain('SECRET_TOKEN');
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

  it('classifies complexity as complex with 2+ services and missing env vars', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
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
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.includes('.env')) {
        return 'API_KEY=\n';
      }
      return '';
    });

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/complex-app',
      branch: 'main',
    });

    expect(plan.complexity).toBe('complex');
    expect(plan.services).toHaveLength(2);
    expect(plan.missing).toContain('API_KEY');
  });
});
