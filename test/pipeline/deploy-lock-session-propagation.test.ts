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
    pullImage: vi.fn().mockResolvedValue(undefined),
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
    loadDeployConfig: vi.fn().mockResolvedValue(null),
    loadDeployConfigForService: vi.fn().mockResolvedValue(null),
    getEnvironmentsByProject: vi.fn().mockResolvedValue([]),
    updateEnvironment: vi.fn().mockResolvedValue(undefined),
    getChildProjects: vi.fn().mockResolvedValue([]),
    getLastDeployLog: vi.fn().mockResolvedValue(null),
    cleanExpiredDeployLocks: vi.fn().mockResolvedValue(0),
  } as unknown as Database;
}

const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

function buildPipeline(db: Database, docker: Docker = createMockDocker()): DeployPipeline {
  return new DeployPipeline(
    docker,
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

  it('rejects image/manual-restore redeploys without image_url before tearing down the live container', async () => {
    const project = {
      ...makeExistingProjectRow('p-manual-restore', 'manual-restore-app'),
      source: 'image',
      image_url: null,
      image_tag: 'local/manual-restore-app:latest',
    };
    const db = createMockDb(project);
    const docker = createMockDocker();
    const deployable = {
      id: 'p-manual-restore__svc',
      project_id: 'p-manual-restore',
      name: 'app',
      kind: 'image',
      source: 'image',
      status: 'running',
      repo_url: null,
      image_url: null,
      image_tag: 'local/manual-restore-app:latest',
      assigned_port: 10001,
    };
    (db.getDeployableForProject as ReturnType<typeof vi.fn>).mockResolvedValue(deployable);
    (db.getEnvironmentsByProject as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p-manual-restore-production', type: 'production' },
    ]);
    const pipeline = buildPipeline(db, docker);

    await expect(pipeline.redeploy('p-manual-restore')).rejects.toMatchObject({
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
    });

    expect(docker.safeRemoveContainer).not.toHaveBeenCalled();
    expect(docker.removeContainer).not.toHaveBeenCalled();
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('rejects local OpenLander image tags before tearing down the live container', async () => {
    const project = {
      ...makeExistingProjectRow('p-local-image', 'home-menu'),
      source: 'image',
      image_url: 'openlander/home-menu:latest',
      image_tag: 'openlander/home-menu:latest',
    };
    const db = createMockDb(project);
    const docker = createMockDocker();
    const deployable = {
      id: 'p-local-image__svc',
      project_id: 'p-local-image',
      name: 'app',
      kind: 'image',
      source: 'image',
      status: 'running',
      repo_url: null,
      image_url: 'openlander/home-menu:latest',
      image_tag: 'openlander/home-menu:latest',
      assigned_port: 10001,
    };
    (db.getDeployableForProject as ReturnType<typeof vi.fn>).mockResolvedValue(deployable);
    (db.getEnvironmentsByProject as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p-local-image-production', type: 'production', container_id: 'container-1' },
    ]);
    const pipeline = buildPipeline(db, docker);

    await expect(pipeline.redeploy('p-local-image')).rejects.toMatchObject({
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
    });

    expect(docker.pullImage).not.toHaveBeenCalled();
    expect(docker.safeRemoveContainer).not.toHaveBeenCalled();
    expect(docker.removeContainer).not.toHaveBeenCalled();
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('pull-checks remote image redeploys before tearing down the live container', async () => {
    const project = {
      ...makeExistingProjectRow('p-remote-image', 'remote-image-app'),
      source: 'image',
      image_url: 'ghcr.io/acme/missing:latest',
      image_tag: 'ghcr.io/acme/current:latest',
    };
    const db = createMockDb(project);
    const docker = createMockDocker();
    (docker.pullImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('repository does not exist'),
    );
    const deployable = {
      id: 'p-remote-image__svc',
      project_id: 'p-remote-image',
      name: 'app',
      kind: 'image',
      source: 'image',
      status: 'running',
      repo_url: null,
      image_url: 'ghcr.io/acme/missing:latest',
      image_tag: 'ghcr.io/acme/current:latest',
      assigned_port: 10001,
    };
    (db.getDeployableForProject as ReturnType<typeof vi.fn>).mockResolvedValue(deployable);
    (db.getEnvironmentsByProject as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p-remote-image-production', type: 'production', container_id: 'container-1' },
    ]);
    const pipeline = buildPipeline(db, docker);

    await expect(pipeline.redeploy('p-remote-image')).rejects.toMatchObject({
      code: 'IMAGE_PULL_FAILED',
    });

    expect(docker.pullImage).toHaveBeenCalledWith('ghcr.io/acme/missing:latest');
    expect(docker.safeRemoveContainer).not.toHaveBeenCalled();
    expect(docker.removeContainer).not.toHaveBeenCalled();
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('uses canonical service source when deciding whether to preserve previous image tags', async () => {
    const project = {
      ...makeExistingProjectRow('p-service-image', 'service-image-app'),
      source: 'git',
      image_tag: 'openlander/service-image-app:stale-project',
      assigned_port: 10001,
    };
    const db = createMockDb(project);
    const docker = createMockDocker();
    const deployable = {
      id: 'p-service-image__svc',
      project_id: 'p-service-image',
      name: 'app',
      kind: 'image',
      source: 'image',
      status: 'running',
      repo_url: null,
      image_url: 'ghcr.io/acme/service-image-app:latest',
      image_tag: 'ghcr.io/acme/service-image-app:current',
      assigned_port: 12001,
      container_id: 'service-image-container',
    };
    (db.getDeployableForProject as ReturnType<typeof vi.fn>).mockResolvedValue(deployable);
    (db.getEnvironmentsByProject as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'p-service-image-production', type: 'production', container_id: 'container-1' },
    ]);
    const pipeline = buildPipeline(db, docker);
    const deploySpy = vi.spyOn(pipeline, 'deploy').mockResolvedValue({
      success: true,
      projectId: 'p-service-image',
      projectName: 'service-image-app',
    });

    await expect(pipeline.redeploy('p-service-image')).resolves.toMatchObject({
      success: true,
    });

    expect(docker.pullImage).toHaveBeenCalledWith('ghcr.io/acme/service-image-app:latest');
    expect(docker.tagImage).not.toHaveBeenCalled();
    expect(deploySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'image',
        imageUrl: 'ghcr.io/acme/service-image-app:latest',
        _preferredPort: 12001,
      }),
    );
  });
});
