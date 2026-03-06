import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import { JobManager } from '../src/pipeline/job-manager.js';
import type { Docker } from '../src/pipeline/docker.js';

// Minimal Docker mock — just enough to not crash
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
  } as unknown as Docker;
}

describe('DeployPipeline — non-blocking deploy', () => {
  let db: Database;
  let tmpDir: string;
  let jobManager: JobManager;
  let pipeline: DeployPipeline;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-start-deploy-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    jobManager = new JobManager();
    pipeline = new DeployPipeline(
      createMockDocker(),
      db,
      {
        getEnvVars: vi.fn().mockReturnValue({}),
        getMergedForDeploy: vi.fn().mockResolvedValue({}),
      } as never,
      jobManager,
    );
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startDeploy', () => {
    it('returns immediately with projectId and status building', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
      });

      expect(result).toEqual({
        projectId: expect.any(String) as string,
        projectName: 'my-app',
        status: 'building',
      });
      expect(result.projectId).toHaveLength(12);
    });

    it('creates a project record in DB immediately', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
      });

      const project = db.getProject(result.projectId);
      expect(project).toBeDefined();
      expect(project!.name).toBe('my-app');
      expect(project!.status).toBe('building');
    });

    it('tracks job in JobManager immediately', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
      });

      const job = jobManager.getStatus(result.projectId);
      expect(job).toBeDefined();
      expect(job!.phase).toBe('queued');
      expect(job!.projectName).toBe('my-app');
    });

    it('uses provided project name', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        name: 'custom-name',
      });

      expect(result.projectName).toBe('custom-name');
      const project = db.getProject(result.projectId);
      expect(project!.name).toBe('custom-name');
    });

    it('extracts project name from repo URL when not provided', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/org/super-project.git',
      });

      expect(result.projectName).toBe('super-project');
    });

    it('returns a promise (async preflight check)', async () => {
      const result = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/app',
      });

      // Result has status building after preflight passes
      expect(result.status).toBe('building');
    });

    it('reuses existing project instead of creating duplicate on same name', async () => {
      // First deploy creates the project
      const first = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
      });

      expect(first.projectName).toBe('my-app');
      const firstProject = db.getProject(first.projectId);
      expect(firstProject).toBeDefined();

      // Second deploy with same repo (same extracted name) should reuse
      const second = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        branch: 'main',
      });

      expect(second.projectName).toBe('my-app');
      expect(second.projectId).toBe(first.projectId);
      expect(second.status).toBe('building');

      // Should still be only one project with that name
      const project = db.getProjectByName('my-app');
      expect(project).toBeDefined();
      expect(project!.id).toBe(first.projectId);
    });

    it('reuses existing project when explicit name matches', async () => {
      const first = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/repo',
        name: 'custom-name',
      });

      const second = await pipeline.startDeploy({
        repoUrl: 'https://github.com/user/repo',
        name: 'custom-name',
      });

      expect(second.projectId).toBe(first.projectId);
      expect(second.status).toBe('building');
    });
  });

  describe('startMonorepoDeploy', () => {
    it('returns immediately with parentProjectId and status building', () => {
      const result = pipeline.startMonorepoDeploy({
        repoUrl: 'https://github.com/user/mono',
        clonePath: '/tmp/mono',
        commitSha: 'abc123',
        dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      });

      expect(result).toEqual({
        parentProjectId: expect.any(String) as string,
        parentName: 'mono',
        status: 'building',
      });
      expect(result.parentProjectId).toHaveLength(12);
    });

    it('creates parent project record in DB immediately', () => {
      const result = pipeline.startMonorepoDeploy({
        repoUrl: 'https://github.com/user/mono',
        clonePath: '/tmp/mono',
        commitSha: 'abc123',
        dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      });

      const project = db.getProject(result.parentProjectId);
      expect(project).toBeDefined();
      expect(project!.name).toBe('mono');
      expect(project!.status).toBe('building');
    });

    it('tracks parent job in JobManager immediately', () => {
      const result = pipeline.startMonorepoDeploy({
        repoUrl: 'https://github.com/user/mono',
        clonePath: '/tmp/mono',
        commitSha: 'abc123',
        dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      });

      const job = jobManager.getStatus(result.parentProjectId);
      expect(job).toBeDefined();
      expect(job!.phase).toBe('queued');
    });

    it('is synchronous (does not return a promise)', () => {
      const result = pipeline.startMonorepoDeploy({
        repoUrl: 'https://github.com/user/mono',
        clonePath: '/tmp/mono',
        commitSha: 'abc123',
        dockerfiles: ['frontend/Dockerfile'],
      });

      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('building');
    });
  });
});
