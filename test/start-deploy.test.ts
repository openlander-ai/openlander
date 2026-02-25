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
    pipeline = new DeployPipeline(createMockDocker(), db, jobManager);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('startDeploy', () => {
    it('returns immediately with projectId and status building', () => {
      const result = pipeline.startDeploy({
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

    it('creates a project record in DB immediately', () => {
      const result = pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
      });

      const project = db.getProject(result.projectId);
      expect(project).toBeDefined();
      expect(project!.name).toBe('my-app');
      expect(project!.status).toBe('building');
    });

    it('tracks job in JobManager immediately', () => {
      const result = pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
      });

      const job = jobManager.getStatus(result.projectId);
      expect(job).toBeDefined();
      expect(job!.phase).toBe('queued');
      expect(job!.projectName).toBe('my-app');
    });

    it('uses provided project name', () => {
      const result = pipeline.startDeploy({
        repoUrl: 'https://github.com/user/my-app',
        name: 'custom-name',
      });

      expect(result.projectName).toBe('custom-name');
      const project = db.getProject(result.projectId);
      expect(project!.name).toBe('custom-name');
    });

    it('extracts project name from repo URL when not provided', () => {
      const result = pipeline.startDeploy({
        repoUrl: 'https://github.com/org/super-project.git',
      });

      expect(result.projectName).toBe('super-project');
    });

    it('is synchronous (does not return a promise)', () => {
      const result = pipeline.startDeploy({
        repoUrl: 'https://github.com/user/app',
      });

      // Result is a plain object, not a Promise
      expect(result).not.toBeInstanceOf(Promise);
      expect(result.status).toBe('building');
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
