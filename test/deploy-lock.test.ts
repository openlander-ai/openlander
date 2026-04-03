import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import { DeployLockedError } from '../src/errors.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

type EnvLike = {
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-new-123456'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
  } as unknown as Docker;
}

describe('BUG-010: Deploy lock prevents concurrent deploys', () => {
  let tmpDir: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-lock-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);
  });

  afterEach(() => {
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('DB-level lock', () => {
    it('rejects concurrent lock on same project', () => {
      db.createProject({
        id: 'p1',
        name: 'test-app',
        repoUrl: 'https://github.com/test/app',
      });

      const first = db.acquireDeployLock('p1', 'session-1');
      expect(first).toBe(true);

      const second = db.acquireDeployLock('p1', 'session-2');
      expect(second).toBe(false);
    });

    it('allows re-acquisition after release', () => {
      db.createProject({
        id: 'p1',
        name: 'test-app',
        repoUrl: 'https://github.com/test/app',
      });

      db.acquireDeployLock('p1', 'session-1');
      db.releaseDeployLock('p1');

      const result = db.acquireDeployLock('p1', 'session-2');
      expect(result).toBe(true);
    });

    it('allows concurrent locks on different projects', () => {
      db.createProject({
        id: 'p1',
        name: 'app-one',
        repoUrl: 'https://github.com/test/app-one',
      });
      db.createProject({
        id: 'p2',
        name: 'app-two',
        repoUrl: 'https://github.com/test/app-two',
      });

      expect(db.acquireDeployLock('p1', 'session-1')).toBe(true);
      expect(db.acquireDeployLock('p2', 'session-2')).toBe(true);
    });
  });

  describe('DeployLockedError', () => {
    it('has correct code and statusCode', () => {
      const err = new DeployLockedError('p1', 'session-1');
      expect(err.code).toBe('DEPLOY_LOCKED');
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('p1');
      expect(err.name).toBe('DeployLockedError');
    });

    it('serializes with toJSON', () => {
      const err = new DeployLockedError('p1', 'session-1');
      const json = err.toJSON();
      expect(json.error).toBe('DEPLOY_LOCKED');
      expect(json.details).toEqual({ projectId: 'p1', lockedBySession: 'session-1' });
    });
  });

  describe('Pipeline redeploy lock integration', () => {
    it('redeploy throws DeployLockedError when project is locked', async () => {
      db.createProject({
        id: 'p1',
        name: 'locked-app',
        repoUrl: 'https://github.com/test/locked-app',
        branch: 'main',
      });
      db.updateProject('p1', {
        status: 'running',
        containerId: 'container-1',
        assignedPort: 10010,
      });

      db.acquireDeployLock('p1', 'other-session');

      await expect(pipeline.redeploy('p1')).rejects.toThrow(DeployLockedError);
    });

    it('redeploy releases lock after successful completion', async () => {
      db.createProject({
        id: 'p1',
        name: 'release-app',
        repoUrl: 'https://github.com/test/release-app',
        branch: 'main',
      });
      db.updateProject('p1', {
        status: 'running',
        containerId: 'container-1',
        assignedPort: 10010,
      });

      vi.spyOn(pipeline, 'deploy').mockResolvedValue({
        success: true,
        projectId: 'p1',
        projectName: 'release-app',
      });

      await pipeline.redeploy('p1');

      const lockInfo = db.getDeployLockInfo('p1');
      expect(lockInfo).toBeNull();
    });

    it('redeploy releases lock even after failure', async () => {
      db.createProject({
        id: 'p1',
        name: 'fail-app',
        repoUrl: 'https://github.com/test/fail-app',
        branch: 'main',
      });
      db.updateProject('p1', {
        status: 'running',
        containerId: 'container-1',
        assignedPort: 10010,
      });

      vi.spyOn(pipeline, 'deploy').mockRejectedValue(new Error('build failed'));

      await pipeline.redeploy('p1').catch(() => undefined);

      const lockInfo = db.getDeployLockInfo('p1');
      expect(lockInfo).toBeNull();
    });

    it('missing project skips lock and returns not-found', async () => {
      const result = await pipeline.redeploy('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Project not found');
    });
  });
});
