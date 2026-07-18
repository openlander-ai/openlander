import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
  redactRepoUrl: vi.fn((value: string) => value),
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
import { ComposePipeline } from '../src/pipeline/compose.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { Database } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';

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
      getProject: vi.fn().mockResolvedValue(null),
      getProjectByName: vi.fn().mockResolvedValue(null),
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

  it('persists only the selected credential ID in the deploy plan', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'credential123',
      branch: 'main',
      gitCredentialId: 'gitcred_1',
    });
    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/private-app',
      gitCredentialId: 'gitcred_1',
    });

    expect(mockCloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({ gitCredentialId: 'gitcred_1' }),
    );
    expect(plan.app.source.git_credential_id).toBe('gitcred_1');
    const stored = mockDb.createDeployPlan.mock.calls[0][0].planJson as string;
    expect(JSON.parse(stored).app.source.git_credential_id).toBe('gitcred_1');
    expect(stored).not.toContain('private_key');
    expect(stored).not.toContain('openlander-git-key');
  });

  it('uses project_id as the existing project target when creating a plan', async () => {
    mockDb.getProject.mockResolvedValue({ id: 'target-project', name: 'workspace' });
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'target123',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/worker',
      branch: 'main',
      name: 'worker',
      projectId: 'target-project',
    });

    expect(plan.project_id).toBe('target-project');
    expect(plan.app.name).toBe('workspace');
    expect(mockEnv.getAll).toHaveBeenCalledWith('target-project');
    const call = mockDb.createDeployPlan.mock.calls[0][0];
    expect(call.projectName).toBe('workspace');
    expect(JSON.parse(call.planJson).project_id).toBe('target-project');
  });

  it('rejects an unknown project_id instead of silently creating a new project target', async () => {
    mockDb.getProject.mockResolvedValue(null);

    await expect(
      engine.createPlan({
        repoUrl: 'https://github.com/test/worker',
        branch: 'main',
        projectId: 'missing-project',
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      details: { identifier: 'missing-project' },
    });

    expect(mockCloneRepo).not.toHaveBeenCalled();
    expect(mockDb.createDeployPlan).not.toHaveBeenCalled();
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

  it('does not require PUBLIC_DIR when source code provides a path fallback', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'plan-public-dir-'));
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(
      join(repoPath, 'server.js'),
      [
        "import path from 'node:path';",
        "const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');",
      ].join('\n'),
    );

    mockCloneRepo.mockResolvedValue({
      path: repoPath,
      commitSha: 'public-dir-fallback',
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
      repoUrl: 'https://github.com/test/public-dir-app',
      branch: 'main',
    });

    expect(plan.status).toBe('ready');
    expect(plan.missing).not.toContain('PUBLIC_DIR');
    expect(plan.env.detected).toContainEqual(
      expect.objectContaining({
        key: 'PUBLIC_DIR',
        required: false,
      }),
    );

    rmSync(repoPath, { recursive: true, force: true });
  });

  it('surfaces needs_approval when postgresql is detected without a scoped service', async () => {
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
    // Proposed safe managed resource → auto-provisionable on approval, so the
    // plan needs approval rather than manual DATABASE_URL input.
    expect(plan.status).toBe('needs_approval');
    expect(plan.missing).not.toContain('DATABASE_URL');
  });

  it('does not reuse managed services from other projects during plan creation', async () => {
    const otherProjectService = {
      id: 'other-pg',
      project_id: 'other-project',
      name: 'live-service-db',
      kind: 'postgres',
    };
    mockDb.getProjectByName.mockResolvedValue({ id: 'babycup-project', name: 'babycup' });
    mockDb.listServices.mockResolvedValue([otherProjectService]);
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'cross123',
    });
    mockAnalyzeInfra.mockImplementation((_repoPath, existingServices) => {
      expect(existingServices).toEqual([]);
      return {
        needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
        available: [],
        missing: [{ type: 'postgresql', suggestion: 'Create a postgresql service' }],
      };
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/babycup',
      branch: 'main',
      name: 'babycup',
    });

    // A proposed safe managed resource (postgresql) is auto-provisionable on
    // approval, so its DATABASE_URL is not "missing"; the plan surfaces as
    // needs_approval rather than needs_input.
    expect(plan.status).toBe('needs_approval');
    expect(plan.missing).not.toContain('DATABASE_URL');
    expect(plan.services[0]).toMatchObject({
      type: 'postgresql',
      action: 'create',
      connect_via: 'DATABASE_URL',
    });
  });

  it('reuses only managed services from the target project during plan creation', async () => {
    const sameProjectService = {
      id: 'babycup-pg',
      project_id: 'babycup-project',
      name: 'babycup-pg',
      kind: 'postgres',
    };
    const otherProjectService = {
      id: 'other-pg',
      project_id: 'other-project',
      name: 'live-service-db',
      kind: 'postgres',
    };
    mockDb.getProjectByName.mockResolvedValue({ id: 'babycup-project', name: 'babycup' });
    mockDb.listServices.mockResolvedValue([sameProjectService, otherProjectService]);
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'same123',
    });
    mockAnalyzeInfra.mockImplementation((_repoPath, existingServices) => {
      expect(existingServices).toEqual([sameProjectService]);
      return {
        needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
        available: [
          {
            type: 'postgresql',
            name: sameProjectService.name,
            id: sameProjectService.id,
            connectVia: 'DATABASE_URL',
          },
        ],
        missing: [],
      };
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/babycup',
      branch: 'main',
      name: 'babycup',
    });

    expect(plan.status).toBe('ready');
    expect(plan.missing).not.toContain('DATABASE_URL');
    expect(plan.services[0]).toMatchObject({
      type: 'postgresql',
      action: 'reuse',
      service_id: sameProjectService.id,
      name: sameProjectService.name,
      connect_via: 'DATABASE_URL',
    });
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
    expect(plan.build.traffic_service).toBe('web');
    expect(mockComposePipeline.detectComposeFile).toHaveBeenCalled();
  });

  it('requires an explicit traffic service when multiple applications expose ports', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [
          { name: 'web', build: './web', ports: ['3000:3000'] },
          { name: 'api', build: './api', ports: ['4000:4000'] },
          { name: 'db', image: 'postgres:16' },
        ],
      }),
    };
    const engineWithCompose = new PlanEngine({
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: mockComposePipeline as unknown as PlanEngineDeps['composePipeline'],
    });

    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'compose-traffic-test',
    });
    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/compose-app',
      branch: 'main',
    });

    expect(plan.status).toBe('needs_input');
    expect(plan.build.traffic_service).toBeUndefined();
    expect(plan.build.traffic_service_candidates).toEqual(['web', 'api']);
  });

  it('does not require empty template values from an optional compose env_file', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'plan-optional-compose-env-'));
    writeFileSync(join(repoPath, '.env.example'), 'GEMINI_API_KEY=\nOPTIONAL_ORG_ID=\n');
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(
      join(repoPath, 'docker-compose.yml'),
      `services:
  api:
    build: .
    env_file:
      - path: .env
        required: false
`,
    );
    mockCloneRepo.mockResolvedValue({ path: repoPath, commitSha: 'optional-compose-env' });
    mockAnalyzeInfra.mockReturnValue({ needs: [], available: [], missing: [] });
    mockExistsSync.mockImplementation((path) => {
      const value = String(path);
      return (
        value === join(repoPath, '.env.example') ||
        value === join(repoPath, 'Dockerfile') ||
        value === join(repoPath, 'docker-compose.yml')
      );
    });
    mockReadFileSync.mockImplementation((path) => {
      const value = String(path);
      if (value.endsWith('.env.example')) return 'GEMINI_API_KEY=\nOPTIONAL_ORG_ID=\n';
      if (value.endsWith('docker-compose.yml')) {
        return `services:
  api:
    build: .
    env_file:
      - path: .env
        required: false
`;
      }
      return 'FROM node:22\n';
    });
    const engineWithCompose = new PlanEngine({
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: new ComposePipeline({} as Docker, {} as Database, new EventBus()),
    });

    try {
      const plan = await engineWithCompose.createPlan({
        repoUrl: 'https://github.com/test/optional-compose-env',
      });

      expect(plan.status).toBe('ready');
      expect(plan.missing).toEqual([]);
      expect(plan.env.detected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'GEMINI_API_KEY', required: false }),
          expect.objectContaining({ key: 'OPTIONAL_ORG_ID', required: false }),
        ]),
      );
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
    }
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

  it('classifies a proposed managed postgres dependency as proposed_project_service / safe_resource with a reason', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'resolution-pg',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'schema.prisma:postgresql' }],
      available: [],
      missing: [
        {
          type: 'postgresql',
          suggestion: 'Create a postgresql service',
          detectedFrom: 'schema.prisma:postgresql',
        },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/resolution-pg-app',
      branch: 'main',
    });

    expect(plan.services).toHaveLength(1);
    expect(plan.services[0]).toMatchObject({
      type: 'postgresql',
      action: 'create',
      resolution: 'proposed_project_service',
      approval: 'safe_resource',
      reason: 'schema.prisma:postgresql',
    });
  });

  it('classifies rabbitmq as not_auto_creatable and mongodb as safe_resource on proposed services', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'resolution-approval',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [
        { type: 'rabbitmq', detectedFrom: 'amqplib' },
        { type: 'mongodb', detectedFrom: 'mongoose' },
      ],
      available: [],
      missing: [
        { type: 'rabbitmq', suggestion: 'Create a rabbitmq service', detectedFrom: 'amqplib' },
        { type: 'mongodb', suggestion: 'Create a mongodb service', detectedFrom: 'mongoose' },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/approval-app',
      branch: 'main',
    });

    const rabbit = plan.services.find((svc) => svc.type === 'rabbitmq');
    const mongo = plan.services.find((svc) => svc.type === 'mongodb');
    expect(rabbit).toMatchObject({
      action: 'create',
      resolution: 'needs_user_input',
      approval: 'not_auto_creatable',
    });
    expect(mongo).toMatchObject({
      action: 'create',
      resolution: 'proposed_project_service',
      approval: 'safe_resource',
    });
  });

  it('classifies a reused existing service as existing_project_service with a reason', async () => {
    const sameProjectService = {
      id: 'babycup-pg',
      project_id: 'babycup-project',
      name: 'babycup-pg',
      kind: 'postgres',
    };
    mockDb.getProjectByName.mockResolvedValue({ id: 'babycup-project', name: 'babycup' });
    mockDb.listServices.mockResolvedValue([sameProjectService]);
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'reuse-resolution',
    });
    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [
        {
          type: 'postgresql',
          name: sameProjectService.name,
          id: sameProjectService.id,
          connectVia: 'DATABASE_URL',
          detectedFrom: 'pg',
        },
      ],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/babycup',
      branch: 'main',
      name: 'babycup',
    });

    expect(plan.services[0]).toMatchObject({
      type: 'postgresql',
      action: 'reuse',
      service_id: sameProjectService.id,
      resolution: 'existing_project_service',
      approval: 'safe_resource',
      reason: 'pg',
    });
  });

  it('reclassifies a compose-declared postgres dependency as compose_service, not a proposed managed create', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [
          { name: 'web', build: '.', ports: ['3000:3000'] },
          { name: 'db', image: 'postgres:16-alpine' },
        ],
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
      commitSha: 'compose-crosscheck',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'schema.prisma:postgresql' }],
      available: [],
      missing: [
        {
          type: 'postgresql',
          suggestion: 'Create a postgresql service',
          detectedFrom: 'schema.prisma:postgresql',
        },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/compose-pg-app',
      branch: 'main',
    });

    expect(plan.build.method).toBe('compose');
    const pg = plan.services.find((svc) => svc.type === 'postgresql');
    expect(pg).toMatchObject({
      type: 'postgresql',
      resolution: 'compose_service',
    });
    expect(pg?.resolution).not.toBe('proposed_project_service');
    expect(
      plan.services.some(
        (svc) => svc.type === 'postgresql' && svc.resolution === 'proposed_project_service',
      ),
    ).toBe(false);
  });

  it('recognizes pgvector compose images as PostgreSQL dependencies', async () => {
    const mockComposePipeline = {
      detectComposeFile: vi.fn().mockReturnValue('/tmp/test-repo/docker-compose.yml'),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [
          { name: 'api', build: '.', dependsOn: ['db'] },
          { name: 'db', image: 'pgvector/pgvector:pg18' },
        ],
      }),
    };
    const engineWithCompose = new PlanEngine({
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
      composePipeline: mockComposePipeline as unknown as PlanEngineDeps['composePipeline'],
    });
    mockCloneRepo.mockResolvedValue({ path: '/tmp/test-repo', commitSha: 'pgvector-compose' });
    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'DATABASE_URL' }],
      available: [],
      missing: [
        {
          type: 'postgresql',
          suggestion: 'Create a postgresql service',
          detectedFrom: 'DATABASE_URL',
        },
      ],
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engineWithCompose.createPlan({
      repoUrl: 'https://github.com/test/compose-pgvector-app',
      branch: 'main',
    });

    expect(plan.services[0]).toMatchObject({
      type: 'postgresql',
      resolution: 'compose_service',
    });
  });

  it('keeps a compose-detected postgres dependency as proposed_project_service for a dockerfile build', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'dockerfile-not-compose',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'schema.prisma:postgresql' }],
      available: [],
      missing: [
        {
          type: 'postgresql',
          suggestion: 'Create a postgresql service',
          detectedFrom: 'schema.prisma:postgresql',
        },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('FROM node:22\n');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/dockerfile-pg-app',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
    });

    expect(plan.build.method).toBe('dockerfile');
    expect(plan.services.find((svc) => svc.type === 'postgresql')).toMatchObject({
      resolution: 'proposed_project_service',
    });
  });

  it('does not emit forbidden next-action fields or a proposed_resources key on the created plan', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'no-forbidden-fields',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [],
      missing: [
        { type: 'postgresql', suggestion: 'Create a postgresql service', detectedFrom: 'pg' },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/forbidden-app',
      branch: 'main',
    });

    const serialized = JSON.stringify(plan);
    for (const forbidden of ['build_log_call', 'retry_call', 'next_call', 'proposed_resources']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(plan).not.toHaveProperty('proposed_resources');
  });

  // P2 status-priority gate: needs_input (missing>0) > needs_approval (>=1 safe
  // proposed resource) > ready. A missing user secret always wins, even when a
  // safe proposed managed resource would otherwise surface needs_approval.
  it('prioritizes needs_input over needs_approval when a required user secret is missing alongside a safe proposed resource', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'plan-priority-input-'));
    writeFileSync(join(repoPath, '.env.example'), 'API_KEY=\n');
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');

    mockCloneRepo.mockResolvedValue({
      path: repoPath,
      commitSha: 'priority-input',
    });

    // A safe proposed postgresql dependency (would be needs_approval on its own)
    // co-exists with a missing user secret (API_KEY) from .env.example.
    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [],
      missing: [
        { type: 'postgresql', suggestion: 'Create a postgresql service', detectedFrom: 'pg' },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    mockReadFileSync.mockImplementation(actualFs.readFileSync);

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/priority-input-app',
      branch: 'main',
    });

    expect(plan.status).toBe('needs_input');
    expect(plan.missing).toContain('API_KEY');
    // The proposed safe resource is still classified, but does not downgrade the
    // status — the missing user secret takes priority.
    expect(plan.services.find((svc) => svc.type === 'postgresql')).toMatchObject({
      resolution: 'proposed_project_service',
      approval: 'safe_resource',
    });

    rmSync(repoPath, { recursive: true, force: true });
  });

  it('yields needs_approval when only a safe proposed resource needs approval and no user input is missing', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'priority-approval',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [],
      missing: [
        { type: 'postgresql', suggestion: 'Create a postgresql service', detectedFrom: 'pg' },
      ],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/priority-approval-app',
      branch: 'main',
    });

    expect(plan.status).toBe('needs_approval');
    expect(plan.missing).toHaveLength(0);
    expect(plan.services.find((svc) => svc.type === 'postgresql')).toMatchObject({
      resolution: 'proposed_project_service',
      approval: 'safe_resource',
    });
  });

  it('yields ready when neither user input is missing nor a safe proposed resource needs approval', async () => {
    mockCloneRepo.mockResolvedValue({
      path: '/tmp/test-repo',
      commitSha: 'priority-ready',
    });

    mockAnalyzeInfra.mockReturnValue({
      needs: [],
      available: [],
      missing: [],
    });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');

    const plan = await engine.createPlan({
      repoUrl: 'https://github.com/test/priority-ready-app',
      branch: 'main',
    });

    expect(plan.status).toBe('ready');
    expect(plan.missing).toHaveLength(0);
    expect(plan.services).toHaveLength(0);
  });
});
