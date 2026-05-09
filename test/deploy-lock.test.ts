import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { DeployPipeline } from '../src/pipeline/deploy.js';
import { JobManager } from '../src/pipeline/job-manager.js';
import { Database } from '../src/db/index.js';
import { DeployLockedError } from '../src/errors.js';
import { eventBus } from '../src/events/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';
import { deployToolDefs } from '../src/tools/defs/deploy.js';

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

function createStatusToolContext(db: Database, jobManager: JobManager): AppContext {
  return {
    db,
    jobManager,
  } as unknown as AppContext;
}

function getDeployStatusTool() {
  const tool = deployToolDefs.find((entry) => entry.name === 'get_deploy_status');
  expect(tool).toBeDefined();
  return tool!;
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

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 200));
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

    it('releaseDeployLock with correct session succeeds', () => {
      db.createProject({
        id: 'p1',
        name: 'session-release-app',
        repoUrl: 'https://github.com/test/session-release-app',
      });

      expect(db.acquireDeployLock('p1', 'session-abc')).toBe(true);
      const releaseDeployLock = Reflect.get(db, 'releaseDeployLock') as (
        projectId: string,
        sessionId?: string,
      ) => boolean;

      expect(releaseDeployLock.call(db, 'p1', 'session-abc')).toBe(true);
      expect(db.getDeployLockInfo('p1')).toBeNull();
    });

    it('releaseDeployLock with wrong session returns false and keeps lock', () => {
      db.createProject({
        id: 'p1',
        name: 'wrong-session-release-app',
        repoUrl: 'https://github.com/test/wrong-session-release-app',
      });

      expect(db.acquireDeployLock('p1', 'session-abc')).toBe(true);
      const releaseDeployLock = Reflect.get(db, 'releaseDeployLock') as (
        projectId: string,
        sessionId?: string,
      ) => boolean;

      expect(releaseDeployLock.call(db, 'p1', 'session-xyz')).toBe(false);
      expect(db.getDeployLockInfo('p1')).toEqual(
        expect.objectContaining({ session: 'session-abc' }),
      );
    });

    it('releaseDeployLock without session releases unconditionally', () => {
      db.createProject({
        id: 'p1',
        name: 'unconditional-release-app',
        repoUrl: 'https://github.com/test/unconditional-release-app',
      });

      expect(db.acquireDeployLock('p1', 'session-abc')).toBe(true);

      expect(db.releaseDeployLock('p1')).toBe(true);
      expect(db.getDeployLockInfo('p1')).toBeNull();
    });

    it('cleanExpiredDeployLocks bypasses session check', () => {
      db.createProject({
        id: 'p1',
        name: 'expired-lock-app',
        repoUrl: 'https://github.com/test/expired-lock-app',
      });

      expect(db.acquireDeployLock('p1', 'session-abc')).toBe(true);

      const sqlite = Reflect.get(db, 'sqlite') as {
        prepare: (sql: string) => { run: (...params: Array<string | number>) => unknown };
      };
      sqlite
        .prepare("UPDATE projects SET deploy_lock_at = datetime('now', '-31 minutes') WHERE id = ?")
        .run('p1');

      expect(db.cleanExpiredDeployLocks()).toBeGreaterThan(0);
      expect(db.getDeployLockInfo('p1')).toBeNull();
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

  describe('get_deploy_status wait=true hardening', () => {
    it('wait=true resolves from deploy_logs when job not in JobManager', async () => {
      db.createProject({
        id: 'p1',
        name: 'status-app',
        repoUrl: 'https://github.com/test/status-app',
      });

      const ctx = createStatusToolContext(db, new JobManager());
      const tool = getDeployStatusTool();

      const resultPromise = tool.execute(
        { project_name: 'status-app', wait: true, timeout: 15 },
        { appCtx: ctx, target: 'agent' },
      ) as Promise<Record<string, unknown>>;

      await new Promise((r) => setTimeout(r, 2000));
      db.createDeployLog({
        id: 'log-1',
        projectId: 'p1',
        status: 'success',
        trigger: 'api',
      });

      const result = await resultPromise;

      expect(result).toMatchObject({
        active: 0,
        jobs: [expect.objectContaining({ name: 'status-app', phase: 'done' })],
      });
      expect(result).not.toHaveProperty('timeout');
    }, 20000);

    it('wait=true ignores deploy_logs created before wait started', async () => {
      db.createProject({
        id: 'p1',
        name: 'old-log-app',
        repoUrl: 'https://github.com/test/old-log-app',
      });
      db.createDeployLog({
        id: 'old-log-1',
        projectId: 'p1',
        status: 'success',
        trigger: 'api',
      });

      const ctx = createStatusToolContext(db, new JobManager());
      const tool = getDeployStatusTool();

      const result = (await tool.execute(
        { project_name: 'old-log-app', wait: true, timeout: 2 },
        { appCtx: ctx, target: 'agent' },
      )) as Record<string, unknown>;

      expect(result).toHaveProperty('timeout', true);

      await new Promise((r) => setTimeout(r, 100));
    }, 10000);

    it('wait=true shows locked/queued when lock held but no active job', async () => {
      db.createProject({
        id: 'p1',
        name: 'locked-status-app',
        repoUrl: 'https://github.com/test/locked-status-app',
      });
      db.acquireDeployLock('p1', 'test-session');

      const ctx = createStatusToolContext(db, new JobManager());
      const tool = getDeployStatusTool();

      const result = (await tool.execute(
        { project_name: 'locked-status-app', wait: true, timeout: 30 },
        { appCtx: ctx, target: 'agent' },
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        active: 1,
        locked: true,
        lock_session: 'test-session',
        jobs: [expect.objectContaining({ name: 'locked-status-app', phase: 'queued' })],
      });
    });

    it('wait=true transitions through queued to done when deploy event fires', async () => {
      db.createProject({
        id: 'p1',
        name: 'evented-status-app',
        repoUrl: 'https://github.com/test/evented-status-app',
      });
      db.acquireDeployLock('p1', 'test-session');

      const jobManager = new JobManager();
      const ctx = createStatusToolContext(db, jobManager);
      const tool = getDeployStatusTool();

      const queuedResult = (await tool.execute(
        { project_name: 'evented-status-app', wait: true, timeout: 30 },
        { appCtx: ctx, target: 'agent' },
      )) as Record<string, unknown>;

      expect(queuedResult).toMatchObject({
        active: 1,
        locked: true,
        lock_session: 'test-session',
        jobs: [expect.objectContaining({ name: 'evented-status-app', phase: 'queued' })],
      });

      jobManager.trackJob('p1', 'evented-status-app');
      jobManager.updatePhase('p1', 'done');
      db.releaseDeployLock('p1');
      await eventBus.emit('deploy:success', {
        projectId: 'p1',
        url: 'https://example.test',
        totalDurationMs: 1000,
      });

      const doneResult = (await tool.execute(
        { project_name: 'evented-status-app', wait: true, timeout: 30 },
        { appCtx: ctx, target: 'agent' },
      )) as Record<string, unknown>;

      expect(doneResult).toMatchObject({
        active: 0,
        jobs: [expect.objectContaining({ name: 'evented-status-app', phase: 'done' })],
      });
    });
  });
});
