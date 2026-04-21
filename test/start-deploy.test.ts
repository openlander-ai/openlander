import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import { JobManager } from '../src/pipeline/job-manager.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache, clearPortReservations } from '../src/pipeline/port.js';
import { eventBus } from '../src/events/index.js';

// Minimal Docker mock — just enough to not crash
function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-abc123'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
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
  const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-start-deploy-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    jobManager = new JobManager();
    pipeline = new DeployPipeline(
      createMockDocker(),
      db,
      {
        getGlobalSecrets: vi.fn().mockReturnValue({}),
        getAll: vi.fn().mockReturnValue({}),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      } as never,
      testConfig,
      jobManager,
    );
    vi.spyOn(pipeline, 'deploy').mockResolvedValue({
      success: true,
      projectId: 'background-project',
      projectName: 'background-project',
    });
    vi.spyOn(pipeline, 'deployMonorepo').mockResolvedValue({
      success: true,
      parentProjectId: 'background-parent',
      parentName: 'background-parent',
      children: [],
      buildDurationMs: 0,
    });
  });

  afterEach(() => {
    clearPortScanCache();
    clearPortReservations();
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

    // -------------------------------------------------------------------------
    // Day 8 Bug #3: When fireAndForgetDeploy() catches an uncaught throw from
    // deploy() (e.g. preflight crash), recordBackgroundFailure must emit
    // `deploy:failed` so plan-engine deploy lock listeners release. Without
    // this, plan-engine locks stayed held until the 30-minute stale window.
    // -------------------------------------------------------------------------
    it('emits deploy:failed when background deploy throws (plan-engine lock release)', async () => {
      // Force the inner deploy() to throw — simulating a crash before any
      // deploy:failed emission happens inside deploy().
      vi.spyOn(pipeline, 'deploy').mockRejectedValueOnce(new Error('preflight exploded'));

      const failures: Array<{ projectId: string; error: string; step: string }> = [];
      const unsub = eventBus.on('deploy:failed', (payload) => {
        failures.push({
          projectId: payload.projectId,
          error: payload.error,
          step: payload.step,
        });
      });

      try {
        const result = await pipeline.startDeploy({
          repoUrl: 'https://github.com/user/crash-app',
        });

        // Wait a microtask cycle for the fire-and-forget chain to settle.
        await new Promise((r) => setTimeout(r, 50));

        expect(failures).toHaveLength(1);
        expect(failures[0]?.projectId).toBe(result.projectId);
        expect(failures[0]?.error).toBe('preflight exploded');
      } finally {
        unsub();
      }
    });

    it('does NOT double-emit deploy:failed when deploy() returns failure result', async () => {
      // deploy() already emits deploy:failed in its own catch path. When it
      // resolves to {success:false}, fireAndForgetDeploy must NOT emit again
      // — only the .catch() (uncaught throw) path should re-emit.
      vi.spyOn(pipeline, 'deploy').mockResolvedValueOnce({
        success: false,
        projectId: 'background-project',
        projectName: 'background-project',
        error: 'controlled failure',
      });

      const failures: Array<{ projectId: string }> = [];
      const unsub = eventBus.on('deploy:failed', (payload) => {
        failures.push({ projectId: payload.projectId });
      });

      try {
        await pipeline.startDeploy({
          repoUrl: 'https://github.com/user/no-double-emit',
        });
        await new Promise((r) => setTimeout(r, 50));

        expect(failures).toHaveLength(0);
      } finally {
        unsub();
      }
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

  describe('deployMonorepo', () => {
    it('uses orchestration rollback path when a child service fails', async () => {
      const clonePath = join(tmpDir, 'mono');
      mkdirSync(join(clonePath, 'frontend'), { recursive: true });
      mkdirSync(join(clonePath, 'backend'), { recursive: true });
      writeFileSync(
        join(clonePath, 'frontend', 'Dockerfile'),
        'FROM node:20\nEXPOSE 3000\n',
        'utf8',
      );
      writeFileSync(
        join(clonePath, 'backend', 'Dockerfile'),
        'FROM node:20\nEXPOSE 4000\n',
        'utf8',
      );

      const docker = createMockDocker();
      (docker.buildImage as ReturnType<typeof vi.fn>).mockImplementation(
        async (contextPath: string, tag: string, options?: { dockerfile?: string }) => {
          if (options?.dockerfile?.includes('backend')) {
            throw new Error('backend build failed');
          }
          return undefined;
        },
      );

      pipeline = new DeployPipeline(
        docker,
        db,
        {
          getGlobalSecrets: vi.fn().mockReturnValue({}),
          getAll: vi.fn().mockReturnValue({}),
          getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
        } as never,
        testConfig,
        jobManager,
      );

      const result = await pipeline.deployMonorepo({
        repoUrl: 'https://github.com/user/mono',
        branch: 'main',
        clonePath,
        commitSha: 'abc123',
        dockerfiles: ['frontend/Dockerfile', 'backend/Dockerfile'],
      });

      expect(result.success).toBe(false);
      expect(result.children).toHaveLength(2);
      expect(result.children.some((child) => child.error?.includes('Rolled back'))).toBe(true);
      expect(docker.stopContainer).toHaveBeenCalled();
      expect(docker.safeRemoveContainer).toHaveBeenCalled();
    });
  });
});
