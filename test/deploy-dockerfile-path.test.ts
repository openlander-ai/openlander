import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import { JobManager } from '../src/pipeline/job-manager.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-abc123'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue('mock logs'),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    cleanupSecretFiles: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('DeployPipeline — dockerfilePath persistence', () => {
  let db: Database;
  let tmpDir: string;
  let jobManager: JobManager;
  let pipeline: DeployPipeline;
  let mockDocker: Docker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-dockerfile-path-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    jobManager = new JobManager();
    mockDocker = createMockDocker();
    pipeline = new DeployPipeline(
      mockDocker,
      db,
      {
        getEnvVars: vi.fn().mockReturnValue({}),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      } as never,
      jobManager,
    );
  });

  afterEach(() => {
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startDeploy() → createProject()', () => {
    it('passes dockerfilePath to createProject when provided', async () => {
      const createProjectSpy = vi.spyOn(db, 'createProject');

      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
        dockerfilePath: 'docker/Dockerfile.prod',
      });

      expect(createProjectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfilePath: 'docker/Dockerfile.prod',
        }),
      );

      const project = db.getProject(result.projectId);
      expect(project!.dockerfile_path).toBe('docker/Dockerfile.prod');

      createProjectSpy.mockRestore();
    });

    it('does NOT pass explicit dockerfilePath when not provided', async () => {
      const createProjectSpy = vi.spyOn(db, 'createProject');

      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
      });

      expect(createProjectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfilePath: undefined,
        }),
      );

      const project = db.getProject(result.projectId);
      expect(project!.dockerfile_path).toBe('Dockerfile');

      createProjectSpy.mockRestore();
    });
  });

  describe('redeploy() → deploy()', () => {
    it('passes stored custom dockerfile_path to deploy() when not default', async () => {
      const projectId = 'test-proj-001';
      db.createProject({
        id: projectId,
        name: 'test-app',
        repoUrl: 'https://github.com/user/test-app',
        branch: 'main',
        dockerfilePath: 'docker/Dockerfile.prod',
      });

      const deploySpy = vi.spyOn(pipeline, 'deploy').mockResolvedValue({
        projectId,
        success: true,
        projectName: 'test-app',
        url: 'http://localhost:3000',
      });

      await pipeline.redeploy(projectId);

      expect(deploySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfilePath: 'docker/Dockerfile.prod',
        }),
      );

      deploySpy.mockRestore();
    });

    it('passes undefined when stored path is default "Dockerfile" (compose detection guard)', async () => {
      const projectId = 'test-proj-002';
      db.createProject({
        id: projectId,
        name: 'test-app',
        repoUrl: 'https://github.com/user/test-app',
        branch: 'main',
      });

      const deploySpy = vi.spyOn(pipeline, 'deploy').mockResolvedValue({
        projectId,
        success: true,
        projectName: 'test-app',
        url: 'http://localhost:3000',
      });

      await pipeline.redeploy(projectId);

      expect(deploySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerfilePath: undefined,
        }),
      );

      deploySpy.mockRestore();
    });

    it('preserves custom dockerfilePath across redeploy cycles', async () => {
      const projectId = 'test-proj-003';
      db.createProject({
        id: projectId,
        name: 'test-app',
        repoUrl: 'https://github.com/user/test-app',
        branch: 'main',
        dockerfilePath: 'docker/Dockerfile.staging',
      });

      let project = db.getProject(projectId);
      expect(project!.dockerfile_path).toBe('docker/Dockerfile.staging');

      vi.spyOn(pipeline, 'deploy').mockResolvedValue({
        projectId,
        success: true,
        projectName: 'test-app',
        url: 'http://localhost:3000',
      });

      await pipeline.redeploy(projectId);

      project = db.getProject(projectId);
      expect(project!.dockerfile_path).toBe('docker/Dockerfile.staging');
    });
  });
});
