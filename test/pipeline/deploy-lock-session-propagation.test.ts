import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { DeployLockedError } from '../../src/errors.js';

vi.mock('../../src/pipeline/preflight.js', () => ({
  preflightCheckOrThrow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
    buildImage: vi.fn().mockResolvedValue(undefined),
    tagImage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

function makeExistingProjectRow(id: string, name: string) {
  return {
    id,
    name,
    status: 'running',
    source: 'git',
    repo_url: `https://github.com/test/${name}`,
    branch: 'main',
    archived_at: null,
    container_id: 'c1',
    image_tag: null,
    previous_image_tag: null,
    assigned_port: 10001,
    deploy_lock_session: null,
    deploy_lock_at: null,
  };
}

function createMockDb(existingProject: ReturnType<typeof makeExistingProjectRow> | null): Database {
  return {
    getProjectByName: vi.fn().mockResolvedValue(existingProject),
    getProject: vi.fn().mockResolvedValue(existingProject),
    createProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
    acquireDeployLock: vi.fn().mockResolvedValue(true),
    releaseDeployLock: vi.fn().mockResolvedValue(undefined),
    getDeployLockInfo: vi.fn().mockReturnValue(null),
    isCircuitBreakerOpen: vi.fn().mockReturnValue(false),
    getDeployableForProject: vi.fn().mockReturnValue(undefined),
    getEnvironmentsByProject: vi.fn().mockResolvedValue([]),
    getLastDeployLog: vi.fn().mockResolvedValue(null),
    cleanExpiredDeployLocks: vi.fn().mockResolvedValue(0),
  } as unknown as Database;
}

const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

function buildPipeline(db: Database): DeployPipeline {
  return new DeployPipeline(
    createMockDocker(),
    db,
    {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    } as never,
    testConfig,
  );
}

describe('BUG: plan-engine deploy-lock session propagation through startDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('existing-project branch', () => {
    it('propagates _lockSessionId to inner deploy() so outer lock session is reused', async () => {
      const db = createMockDb(makeExistingProjectRow('p-existing', 'my-app'));
      const pipeline = buildPipeline(db);

      const deployCalls: Array<{ _lockSessionId: string | undefined }> = [];
      vi.spyOn(pipeline, 'deploy').mockImplementation(async (config) => {
        deployCalls.push({ _lockSessionId: config._lockSessionId });
        return { success: true, projectId: 'p-existing', projectName: 'my-app' };
      });

      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/test/my-app',
        name: 'my-app',
        _lockSessionId: 'plan-abc123',
      });

      expect(result.status).toBe('building');
      expect(deployCalls).toHaveLength(1);
      expect(deployCalls[0]?._lockSessionId).toBe('plan-abc123');
    });

    it('passes undefined _lockSessionId when no outer session (deploy() owns its own lock)', async () => {
      const db = createMockDb(makeExistingProjectRow('p-standalone', 'standalone-app'));
      const pipeline = buildPipeline(db);

      const deployCalls: Array<{ _lockSessionId: string | undefined }> = [];
      vi.spyOn(pipeline, 'deploy').mockImplementation(async (config) => {
        deployCalls.push({ _lockSessionId: config._lockSessionId });
        return { success: true, projectId: 'p-standalone', projectName: 'standalone-app' };
      });

      await pipeline.startDeploy({
        repoUrl: 'https://github.com/test/standalone-app',
        name: 'standalone-app',
      });

      expect(deployCalls).toHaveLength(1);
      expect(deployCalls[0]?._lockSessionId).toBeUndefined();
    });
  });

  describe('new-project branch', () => {
    it('propagates _lockSessionId to deploy() for a brand-new project', async () => {
      const db = createMockDb(null);
      const pipeline = buildPipeline(db);

      const deployCalls: Array<{ _lockSessionId: string | undefined }> = [];
      vi.spyOn(pipeline, 'deploy').mockImplementation(async (config) => {
        deployCalls.push({ _lockSessionId: config._lockSessionId });
        return { success: true, projectId: 'p-new', projectName: 'brand-new' };
      });

      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/test/brand-new',
        name: 'brand-new',
        _lockSessionId: 'plan-session-new',
      });

      expect(result.status).toBe('building');
      expect(deployCalls).toHaveLength(1);
      expect(deployCalls[0]?._lockSessionId).toBe('plan-session-new');
    });

    it('passes undefined _lockSessionId when none provided for new project', async () => {
      const db = createMockDb(null);
      const pipeline = buildPipeline(db);

      const deployCalls: Array<{ _lockSessionId: string | undefined }> = [];
      vi.spyOn(pipeline, 'deploy').mockImplementation(async (config) => {
        deployCalls.push({ _lockSessionId: config._lockSessionId });
        return { success: true, projectId: 'p-fresh', projectName: 'fresh-app' };
      });

      await pipeline.startDeploy({
        repoUrl: 'https://github.com/test/fresh-app',
        name: 'fresh-app',
      });

      expect(deployCalls).toHaveLength(1);
      expect(deployCalls[0]?._lockSessionId).toBeUndefined();
    });
  });

  it('regression guard: when _lockSessionId is absent, inner deploy() receives undefined (will mint its own lock session)', async () => {
    const db = createMockDb(makeExistingProjectRow('p-locked', 'locked-app'));
    const pipeline = buildPipeline(db);

    const deployCalls: Array<{ _lockSessionId: string | undefined }> = [];
    vi.spyOn(pipeline, 'deploy').mockImplementation(async (config) => {
      deployCalls.push({ _lockSessionId: config._lockSessionId });
      return { success: true, projectId: 'p-locked', projectName: 'locked-app' };
    });

    await pipeline.startDeploy({
      repoUrl: 'https://github.com/test/locked-app',
      name: 'locked-app',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(deployCalls).toHaveLength(1);
    expect(deployCalls[0]?._lockSessionId).toBeUndefined();
  });
});
