import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';
import * as portPipeline from '../src/pipeline/port.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as dockerfileGen from '../src/pipeline/dockerfile-gen.js';
import { eventBus } from '../src/events/index.js';

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getAllWithInheritance: (projectId: string, environmentId: string) => Record<string, string>;
  getAllForService: (
    projectId: string,
    serviceId: string,
    environmentId?: string,
  ) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    tagImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-abc123456789'),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
    listAllContainers: vi.fn().mockResolvedValue([]),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('DeployPipeline deployEnvironment', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  let cloneRepoSpy: ReturnType<typeof vi.spyOn>;
  let ensureDockerfileSpy: ReturnType<typeof vi.spyOn>;
  const testConfig = {
    ai: {
      secretScan: { enabled: false },
    },
  } as OpenLanderConfig;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-environment-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getAllWithInheritance: vi.fn((projectId: string, environmentId: string) =>
        env.getAll(projectId, environmentId),
      ),
      getAllForService: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);

    cloneRepoSpy = vi.spyOn(gitPipeline, 'cloneRepo');
    cloneRepoSpy.mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
    });

    ensureDockerfileSpy = vi.spyOn(dockerfileGen, 'ensureDockerfile');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('deployEnvironment clones branch and deploys using production route/container naming', async () => {
    db.createProject({
      id: 'p1',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p1-development',
      projectId: 'p1',
      type: 'development',
      branch: 'develop',
    });

    const result = await pipeline.deployEnvironment('p1', 'p1-development', {
      repoUrl: 'https://github.com/openlander/demo-app',
    });

    expect(result.success).toBe(true);
    expect(cloneRepoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/openlander/demo-app',
        branch: 'develop',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-demo-app',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: { 'traefik.enable': 'false' },
      }),
    );
    expect(result.url).toContain('demo-app.');

    const developmentEnvironment = db.getEnvironment('p1-development');
    expect(developmentEnvironment?.status).toBe('running');
    expect(developmentEnvironment?.container_id).toBe('container-abc123456789');
    expect(developmentEnvironment?.assigned_port).toBeGreaterThanOrEqual(10001);
    expect(developmentEnvironment?.image_tag).toMatch(/^openlander\/demo-app:\d+$/);

    // Verify passive Docker mocks were called
    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      clonePath,
      expect.stringMatching(/^openlander\/demo-app:\d+$/),
      expect.any(Object),
    );
    expect(docker.tagImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.stringMatching(/^openlander\/demo-app:\d+$/),
      'openlander/demo-app',
      'latest',
    );
    expect(docker.waitForHealthy as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-abc123456789',
      expect.any(Number),
    );
    // Verify env mocks were called
    expect(env.getAll as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('p1', 'p1-development');
    expect(env.getSecretFilesForDeploy as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('p1');
  });

  it('deploy() stays backward compatible by routing through production environment', async () => {
    db.createProject({
      id: 'p2',
      name: 'prod-app',
      repoUrl: 'https://github.com/openlander/prod-app',
      branch: 'main',
    });

    const productionEnvironment = db
      .getEnvironmentsByProject('p2')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    db.updateEnvironment(productionEnvironment!.id, { branch: 'release' });

    const result = await pipeline.deploy({
      repoUrl: 'https://github.com/openlander/prod-app',
      branch: 'feature/do-not-use',
      name: 'prod-app',
      _projectId: 'p2',
    });

    expect(result.success).toBe(true);
    expect(cloneRepoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'release',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-prod-app',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: { 'traefik.enable': 'false' },
      }),
    );
    expect(result.url).toContain('prod-app.');

    const refreshedProductionEnvironment = db.getEnvironment(productionEnvironment!.id);
    const project = db.getProject('p2');
    expect(refreshedProductionEnvironment?.status).toBe('running');
    expect(project?.status).toBe('running');
    expect(refreshedProductionEnvironment?.container_id).toBe('container-abc123456789');
    expect(project?.container_id).toBe('container-abc123456789');

    // Verify Docker and env mocks were called
    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(docker.waitForHealthy as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(env.getAll as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'p2',
      productionEnvironment!.id,
    );
    expect(env.getSecretFilesForDeploy as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('p2');
  });

  it('preserves live runtime state when a redeploy build fails before swap', async () => {
    db.createProject({
      id: 'p-safe',
      name: 'safe-app',
      repoUrl: 'https://github.com/openlander/safe-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p-safe')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();
    db.updateProject('p-safe', {
      status: 'running',
      containerId: 'container-live-123',
      containerName: 'ol-safe-app',
      assignedPort: 10042,
      imageTag: 'openlander/safe-app:live',
    });
    db.updateEnvironment(productionEnvironment!.id, {
      status: 'running',
      containerId: 'container-live-123',
      assignedPort: 10042,
      imageTag: 'openlander/safe-app:live',
    });
    (docker.buildImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('build failed before swap'),
    );

    const result = await pipeline.deployEnvironment('p-safe', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/safe-app',
      _projectId: 'p-safe',
      _serviceId: 'p-safe__svc',
      _preferredPort: 10042,
      _preserveLiveContainerUntilRun: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('build failed before swap');
    expect(docker.runContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-live-123',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'ol-safe-app',
    );

    const project = db.getProject('p-safe');
    const environment = db.getEnvironment(productionEnvironment!.id);
    expect(project?.status).toBe('running');
    expect(project?.container_id).toBe('container-live-123');
    expect(project?.assigned_port).toBe(10042);
    expect(project?.image_tag).toBe('openlander/safe-app:live');
    expect(environment?.status).toBe('running');
    expect(environment?.container_id).toBe('container-live-123');
    expect(environment?.assigned_port).toBe(10042);
    expect(environment?.image_tag).toBe('openlander/safe-app:live');

    const deployLog = db.getLastDeployLog('p-safe', productionEnvironment!.id);
    expect(deployLog?.status).toBe('failed');
    expect(deployLog?.build_log).toContain('build failed before swap');
  });

  it('restores the previous image when a preserved redeploy fails during swap run', async () => {
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(10042);
    db.createProject({
      id: 'p-safe-swap',
      name: 'safe-swap-app',
      repoUrl: 'https://github.com/openlander/safe-swap-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p-safe-swap')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();
    db.updateProject('p-safe-swap', {
      status: 'running',
      containerId: 'container-live-123',
      containerName: 'ol-safe-swap-app',
      assignedPort: 10042,
      containerPort: 3000,
      imageTag: 'openlander/safe-swap-app:live',
    });
    db.updateEnvironment(productionEnvironment!.id, {
      status: 'running',
      containerId: 'container-live-123',
      assignedPort: 10042,
      containerPort: 3000,
      imageTag: 'openlander/safe-swap-app:live',
    });
    (docker.runContainer as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('docker create failed after swap'))
      .mockResolvedValueOnce('container-restored-456');

    const result = await pipeline.deployEnvironment('p-safe-swap', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/safe-swap-app',
      _projectId: 'p-safe-swap',
      _serviceId: 'p-safe-swap__svc',
      _preferredPort: 10042,
      _preserveLiveContainerUntilRun: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('docker create failed after swap');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-live-123',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        imageTag: 'openlander/safe-swap-app:live',
        name: 'ol-safe-swap-app',
        port: 10042,
        containerPort: 3000,
      }),
    );

    const project = db.getProject('p-safe-swap');
    const environment = db.getEnvironment(productionEnvironment!.id);
    expect(project?.status).toBe('running');
    expect(project?.container_id).toBe('container-restored-456');
    expect(project?.assigned_port).toBe(10042);
    expect(project?.image_tag).toBe('openlander/safe-swap-app:live');
    expect(environment?.status).toBe('running');
    expect(environment?.container_id).toBe('container-restored-456');
    expect(environment?.assigned_port).toBe(10042);
    expect(environment?.image_tag).toBe('openlander/safe-swap-app:live');

    const deployLog = db.getLastDeployLog('p-safe-swap', productionEnvironment!.id);
    expect(deployLog?.status).toBe('failed');
    expect(deployLog?.build_log).toContain('[rollback] restored previous container');
  });

  it('deployEnvironment uses project naming without dev suffix', async () => {
    db.createProject({
      id: 'p3',
      name: 'dev-app',
      repoUrl: 'https://github.com/openlander/dev-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p3-development',
      projectId: 'p3',
      type: 'development',
      branch: 'dev',
    });

    const result = await pipeline.deployEnvironment('p3', 'p3-development', {
      repoUrl: 'https://github.com/openlander/dev-app',
    });

    expect(result.success).toBe(true);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-dev-app',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: { 'traefik.enable': 'false' },
      }),
    );
    expect(result.url).toContain('dev-app.');

    const developmentEnvironment = db.getEnvironment('p3-development');
    expect(developmentEnvironment?.image_tag).toMatch(/^openlander\/dev-app:\d+$/);
  });

  it('BUG-004: stores timestamp image tag in DB and updates latest alias', async () => {
    db.createProject({
      id: 'p-bug-004-tag',
      name: 'rollback-tag-app',
      repoUrl: 'https://github.com/openlander/rollback-tag-app',
      branch: 'main',
    });

    const result = await pipeline.deploy({
      _projectId: 'p-bug-004-tag',
      name: 'rollback-tag-app',
      repoUrl: 'https://github.com/openlander/rollback-tag-app',
      trigger: 'api',
    });

    expect(result.success).toBe(true);
    const project = db.getProject('p-bug-004-tag');
    expect(project?.image_tag).toMatch(/^openlander\/rollback-tag-app:\d+$/);
    expect(docker.tagImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.stringMatching(/^openlander\/rollback-tag-app:\d+$/),
      'openlander/rollback-tag-app',
      'latest',
    );
  });

  it('delegates to compose pipeline when compose file is detected', async () => {
    db.createProject({
      id: 'p4',
      name: 'compose-app',
      repoUrl: 'https://github.com/openlander/compose-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p4-development',
      projectId: 'p4',
      type: 'development',
      branch: 'compose-branch',
    });

    const composePipeline = {
      detectComposeFile: vi.fn().mockReturnValue(join(clonePath, 'docker-compose.yml')),
      deployCompose: vi.fn().mockResolvedValue({
        success: true,
        parentProjectId: 'p4',
        parentName: 'compose-app',
        buildDurationMs: 321,
      }),
    };
    const composeEnabledPipeline = new DeployPipeline(
      docker,
      db,
      env as never,
      testConfig,
      undefined,
      composePipeline as never,
    );

    const result = await composeEnabledPipeline.deployEnvironment('p4', 'p4-development', {
      repoUrl: 'https://github.com/openlander/compose-app',
      trigger: 'api',
    });

    expect(composePipeline.deployCompose).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/openlander/compose-app',
        branch: 'compose-branch',
        clonePath,
        composePath: join(clonePath, 'docker-compose.yml'),
        name: 'compose-app',
        trigger: 'api',
        environmentType: 'development',
      }),
    );
    expect(docker.buildImage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        projectId: 'p4',
        projectName: 'compose-app',
        buildDurationMs: 321,
      }),
    );
  });

  it('applies pending fix from DB after clone and clears it', async () => {
    db.createProject({
      id: 'p8',
      name: 'pending-fix-app',
      repoUrl: 'https://github.com/openlander/pending-fix-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p8')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    db.updateProject('p8', {
      pendingFix: JSON.stringify({
        filePath: 'Dockerfile',
        content: 'FROM node:20\nEXPOSE 8080\n',
      }),
    });

    let builtDockerfile = '';
    (docker.buildImage as ReturnType<typeof vi.fn>).mockImplementationOnce(async (path: string) => {
      builtDockerfile = readFileSync(join(path, 'Dockerfile'), 'utf8');
    });

    const result = await pipeline.deployEnvironment('p8', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/pending-fix-app',
    });

    expect(result.success).toBe(true);
    expect(builtDockerfile).toContain('FROM node:20');
    expect(db.getProject('p8')?.pending_fix).toBeNull();
  });

  it('applies pending compose fix before delegating to compose pipeline', async () => {
    db.createProject({
      id: 'p9',
      name: 'compose-fix-app',
      repoUrl: 'https://github.com/openlander/compose-fix-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p9-development',
      projectId: 'p9',
      type: 'development',
      branch: 'compose-fix',
    });

    const composePath = join(clonePath, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  web:\n    image: nginx:1\n', 'utf8');
    db.updateProject('p9', {
      pendingFix: JSON.stringify({
        filePath: 'docker-compose.yml',
        content: 'services:\n  web:\n    image: nginx:2\n',
      }),
    });

    const composePipeline = {
      detectComposeFile: vi.fn().mockReturnValue(composePath),
      deployCompose: vi.fn().mockResolvedValue({
        success: true,
        parentProjectId: 'p9',
        parentName: 'compose-fix-app',
        services: [],
        buildDurationMs: 123,
      }),
    };
    const composeEnabledPipeline = new DeployPipeline(
      docker,
      db,
      env as never,
      testConfig,
      undefined,
      composePipeline as never,
    );

    let delegatedComposeFile = '';
    composePipeline.deployCompose.mockImplementationOnce(
      async (config: { composePath: string }) => {
        delegatedComposeFile = readFileSync(config.composePath, 'utf8');
        return {
          success: true,
          parentProjectId: 'p9',
          parentName: 'compose-fix-app',
          services: [],
          buildDurationMs: 123,
        };
      },
    );

    const result = await composeEnabledPipeline.deployEnvironment('p9', 'p9-development', {
      repoUrl: 'https://github.com/openlander/compose-fix-app',
    });

    expect(result.success).toBe(true);
    expect(delegatedComposeFile).toContain('nginx:2');
    expect(db.getProject('p9')?.pending_fix).toBeNull();
    expect(composePipeline.deployCompose).toHaveBeenCalledOnce();
  });

  it('applies patch-based pending fix from DB after clone and clears it', async () => {
    db.createProject({
      id: 'p10',
      name: 'pending-patch-app',
      repoUrl: 'https://github.com/openlander/pending-patch-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p10')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    writeFileSync(
      join(clonePath, 'Dockerfile'),
      'FROM node:22-alpine\nCMD ["npm","start"]\n',
      'utf8',
    );
    db.updateProject('p10', {
      pendingFix: JSON.stringify({
        filePath: 'Dockerfile',
        patches: [
          {
            pattern: 'FROM (node:[^-\\s]+)-alpine',
            replacement: 'FROM $1-bookworm-slim',
            flags: 'gm',
          },
          {
            pattern: '^CMD\\b|^ENTRYPOINT\\b',
            replacement: 'ENV NODE_OPTIONS="--max-old-space-size=4096"\\n$&',
            flags: 'm',
          },
        ],
      }),
    });

    let builtDockerfile = '';
    (docker.buildImage as ReturnType<typeof vi.fn>).mockImplementationOnce(async (path: string) => {
      builtDockerfile = readFileSync(join(path, 'Dockerfile'), 'utf8');
    });

    const result = await pipeline.deployEnvironment('p10', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/pending-patch-app',
    });

    expect(result.success).toBe(true);
    expect(builtDockerfile).toContain('FROM node:22-bookworm-slim');
    expect(builtDockerfile).toContain('ENV NODE_OPTIONS="--max-old-space-size=4096"');
    expect(db.getProject('p10')?.pending_fix).toBeNull();
  });

  it('does not publish automatically when legacy quick-share visibility is supplied', async () => {
    db.createProject({
      id: 'p5',
      name: 'quick-share-app',
      repoUrl: 'https://github.com/openlander/quick-share-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p5')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const result = await pipeline.deployEnvironment('p5', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/quick-share-app',
      visibility: 'quick-share',
    });

    expect(result.success).toBe(true);
    expect(result.publicUrl).toBeUndefined();
    expect(db.getProject('p5')?.visibility).toBe('internal');
    expect(db.getProject('p5')?.public_url).toBeNull();
  });

  it('auto-detects and generates Dockerfile when missing', async () => {
    db.createProject({
      id: 'p6',
      name: 'autodetect-app',
      repoUrl: 'https://github.com/openlander/autodetect-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p6')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    rmSync(join(clonePath, 'Dockerfile'));

    const autoDetector = {
      generateDockerfile: vi.fn().mockResolvedValue({
        generated: true,
        type: 'dockerfile',
        content: 'FROM node:20\nEXPOSE 8080',
      }),
    };
    const autoDetectPipeline = new DeployPipeline(
      docker,
      db,
      env as never,
      testConfig,
      undefined,
      undefined,
      autoDetector as never,
    );

    ensureDockerfileSpy.mockReturnValueOnce({ generated: false, detection: null });

    const result = await autoDetectPipeline.deployEnvironment('p6', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/autodetect-app',
    });

    expect(result.success).toBe(true);
    expect(ensureDockerfileSpy).toHaveBeenCalledWith(clonePath);
    expect(autoDetector.generateDockerfile).toHaveBeenCalledWith(clonePath);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        containerPort: 8080,
      }),
    );

    // Verify Docker build and health check mocks were called
    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(docker.waitForHealthy as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('injects filtered build-time env vars as docker build args', async () => {
    db.createProject({
      id: 'p7',
      name: 'build-args-app',
      repoUrl: 'https://github.com/openlander/build-args-app',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p7')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    (env.getAll as ReturnType<typeof vi.fn>).mockImplementation(
      (_projectId: string, environmentId?: string) => {
        if (environmentId !== undefined) {
          return {};
        }
        return {
          NODE_ENV: 'test',
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
          INTERNAL_SECRET: 'do-not-forward',
        };
      },
    );

    let builtDockerfile = '';
    (docker.buildImage as ReturnType<typeof vi.fn>).mockImplementationOnce(async (path: string) => {
      builtDockerfile = readFileSync(join(path, 'Dockerfile'), 'utf8');
    });

    const result = await pipeline.deployEnvironment('p7', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/build-args-app',
      envVars: {
        VITE_CLIENT_FLAG: 'enabled',
        SERVER_ONLY_TOKEN: 'hidden',
      },
    });

    expect(result.success).toBe(true);
    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      clonePath,
      expect.stringMatching(/^openlander\/build-args-app:\d+$/),
      expect.objectContaining({
        buildArgs: {
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
          VITE_CLIENT_FLAG: 'enabled',
        },
      }),
    );

    const dockerfileContent = builtDockerfile;
    expect(dockerfileContent).toContain('ARG VITE_CLIENT_FLAG');
    expect(dockerfileContent).toContain('ARG NEXT_PUBLIC_API_URL');
    expect(dockerfileContent).not.toContain('ARG SERVER_ONLY_TOKEN');
    expect(dockerfileContent).not.toContain('ARG INTERNAL_SECRET');

    // Verify Docker health check and env mocks were called
    expect(docker.waitForHealthy as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    expect(env.getAll as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'p7',
      productionEnvironment!.id,
    );
  });

  it('returns guard error for environment that does not belong to project', async () => {
    db.createProject({
      id: 'p8',
      name: 'owner-a',
      repoUrl: 'https://github.com/openlander/owner-a',
      branch: 'main',
    });
    db.createProject({
      id: 'p9',
      name: 'owner-b',
      repoUrl: 'https://github.com/openlander/owner-b',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p9-development',
      projectId: 'p9',
      type: 'development',
      branch: 'develop',
    });

    const result = await pipeline.deployEnvironment('p8', 'p9-development', {
      repoUrl: 'https://github.com/openlander/owner-a',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Environment not found: p9-development');
    expect(cloneRepoSpy).not.toHaveBeenCalled();
  });

  it('returns guard error when project is missing', async () => {
    const result = await pipeline.deployEnvironment('missing-project', 'env-x', {
      repoUrl: 'https://github.com/openlander/missing-project',
    });

    expect(result.success).toBe(false);
    expect(result.projectName).toBe('unknown');
    expect(result.error).toBe('Project not found: missing-project');
    expect(cloneRepoSpy).not.toHaveBeenCalled();
  });

  it('returns guard error when environment id does not exist', async () => {
    db.createProject({
      id: 'p10',
      name: 'missing-env-app',
      repoUrl: 'https://github.com/openlander/missing-env-app',
      branch: 'main',
    });

    const result = await pipeline.deployEnvironment('p10', 'p10-nope');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Environment not found: p10-nope');
    expect(cloneRepoSpy).not.toHaveBeenCalled();
  });

  it('returns guard error when repo URL is missing from config and project', async () => {
    db.createProject({
      id: 'p11',
      name: 'repo-less-app',
      repoUrl: '',
      branch: 'main',
    });
    const productionEnvironment = db
      .getEnvironmentsByProject('p11')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const result = await pipeline.deployEnvironment('p11', productionEnvironment!.id);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing repo URL for project: p11');
    expect(cloneRepoSpy).not.toHaveBeenCalled();
  });

  it('does not publish a development environment from legacy visibility config', async () => {
    db.createProject({
      id: 'p12',
      name: 'development-share-app',
      repoUrl: 'https://github.com/openlander/development-share-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p12-development',
      projectId: 'p12',
      type: 'development',
      branch: 'develop',
    });

    const result = await pipeline.deployEnvironment('p12', 'p12-development', {
      visibility: 'quick-share',
    });

    expect(result.success).toBe(true);
    expect(result.publicUrl).toBeUndefined();
    expect(db.getProject('p12')?.visibility).toBe('internal');
    expect(db.getProject('p12')?.public_url).toBeNull();
  });

  it('stores env vars at project scope regardless of environment type', async () => {
    db.createProject({
      id: 'p13',
      name: 'env-store-app',
      repoUrl: 'https://github.com/openlander/env-store-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p13-development',
      projectId: 'p13',
      type: 'development',
      branch: 'develop',
    });

    const mergeEnvVarsSpy = vi.spyOn(db, 'mergeEnvVars');

    const result = await pipeline.deployEnvironment('p13', 'p13-development', {
      envVars: {
        API_BASE_URL: 'https://dev.example.com',
      },
    });

    expect(result.success).toBe(true);
    expect(mergeEnvVarsSpy).toHaveBeenCalledWith('p13', {
      API_BASE_URL: 'https://dev.example.com',
    });
  });

  it('detectFailStep maps incomplete build logs to expected step', () => {
    const detectFailStep = (pipeline as unknown as { detectFailStep: (log: string) => string })
      .detectFailStep;

    expect(detectFailStep('fatal before clone')).toBe('clone');
    expect(detectFailStep('[clone] done')).toBe('dockerfile');
    expect(detectFailStep('[clone] done\n[dockerfile] Found Dockerfile')).toBe('build');
    expect(detectFailStep('[clone] done\n[dockerfile] Found Dockerfile\n[build] ok')).toBe('run');
    expect(
      detectFailStep(
        '[clone] done\n[dockerfile] Found Dockerfile\n[build] ok\n[run] c123\nContainer crashed after start',
      ),
    ).toBe('runtime');
    expect(detectFailStep('[clone]\n[dockerfile]\n[build]\n[run]')).toBe('unknown');
  });

  // ---------------------------------------------------------------------------
  // Day 9 F3: deployEnvironment must emit deploy:failed on its early-return
  // success:false paths. Without this, fireAndForgetDeploy assumes deploy()
  // already emitted (it didn't on these paths), and plan-engine deploy lock
  // listeners / questionBridge active-project clear / activity logger never
  // wake up — locks stay held until 30-minute reconciliation.
  // ---------------------------------------------------------------------------
  describe('deployEnvironment terminal-event guarantees (Day 9 F3)', () => {
    it('emits deploy:failed when project is not found', async () => {
      const failures: Array<{ projectId: string; step: string; error: string }> = [];
      const unsub = eventBus.on('deploy:failed', (payload) => {
        failures.push({
          projectId: payload.projectId,
          step: payload.step,
          error: payload.error,
        });
      });

      try {
        const result = await pipeline.deployEnvironment('missing-project', 'env-1', {});
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Project not found/);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.projectId).toBe('missing-project');
        expect(failures[0]?.step).toBe('lookup');
        expect(failures[0]?.error).toMatch(/Project not found/);
      } finally {
        unsub();
      }
    });

    it('emits deploy:failed when environment is not found', async () => {
      db.createProject({
        id: 'p-race',
        name: 'race-app',
        repoUrl: 'https://github.com/openlander/race',
        branch: 'main',
      });

      const failures: Array<{ projectId: string; step: string }> = [];
      const unsub = eventBus.on('deploy:failed', (payload) => {
        failures.push({ projectId: payload.projectId, step: payload.step });
      });

      try {
        const result = await pipeline.deployEnvironment('p-race', 'missing-env', {});
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Environment not found/);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.projectId).toBe('p-race');
        expect(failures[0]?.step).toBe('lookup');
      } finally {
        unsub();
      }
    });

    it('emits deploy:failed when repo URL is missing for git source', async () => {
      db.createProject({
        id: 'p-norepo',
        name: 'norepo-app',
        repoUrl: '',
        branch: 'main',
      });
      db.createEnvironment({
        id: 'p-norepo-development',
        projectId: 'p-norepo',
        type: 'development',
        branch: 'develop',
      });

      const failures: Array<{ projectId: string; step: string }> = [];
      const unsub = eventBus.on('deploy:failed', (payload) => {
        failures.push({ projectId: payload.projectId, step: payload.step });
      });

      try {
        const result = await pipeline.deployEnvironment('p-norepo', 'p-norepo-development', {
          source: 'git',
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Missing repo URL/);
        expect(failures).toHaveLength(1);
        expect(failures[0]?.projectId).toBe('p-norepo');
        expect(failures[0]?.step).toBe('config');
      } finally {
        unsub();
      }
    });
  });
});
