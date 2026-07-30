import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { DeployLockedError } from '../../src/errors.js';
import { EventBus } from '../../src/events/index.js';
import { ComposePipeline, type ComposeDeployResult } from '../../src/pipeline/compose.js';
import type { Docker } from '../../src/pipeline/docker.js';

function successfulResult(projectId: string): ComposeDeployResult {
  return {
    success: true,
    parentProjectId: projectId,
    parentName: 'compose-app',
    services: [],
    buildDurationMs: 1,
  };
}

function createLockingDb(options: { contention?: boolean } = {}) {
  const heldLocks = new Map<string, string>();
  if (options.contention) heldLocks.set('compose-parent', 'deploy-live-session');

  return {
    createProject: vi.fn().mockResolvedValue(undefined),
    updateProject: vi.fn().mockResolvedValue(undefined),
    acquireDeployLock: vi.fn(async (projectId: string, sessionId: string) => {
      const held = heldLocks.get(projectId);
      if (held && held !== sessionId) return false;
      heldLocks.set(projectId, sessionId);
      return true;
    }),
    releaseDeployLock: vi.fn(async (projectId: string, sessionId?: string) => {
      const held = heldLocks.get(projectId);
      if (!held || (sessionId && held !== sessionId)) return false;
      heldLocks.delete(projectId);
      return true;
    }),
    getDeployLockInfo: vi.fn(async (projectId: string) => {
      const session = heldLocks.get(projectId);
      return session ? { session, lockedAt: new Date().toISOString() } : null;
    }),
  };
}

describe('ComposePipeline deploy lock ownership', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('owns a durable lock around a top-level Compose deployment', async () => {
    const db = createLockingDb();
    const pipeline = new ComposePipeline({} as Docker, db as unknown as Database, new EventBus());
    const inner = vi
      .spyOn(pipeline, 'deployComposeViaDockerode')
      .mockResolvedValue(successfulResult('compose-parent'));

    await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/compose-app',
      clonePath: '/tmp/compose-app',
      composePath: '/tmp/compose-app/compose.yml',
      _parentId: 'compose-parent',
    });

    expect(db.acquireDeployLock).toHaveBeenCalledWith(
      'compose-parent',
      expect.stringMatching(/^compose-/),
    );
    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({
        _parentId: 'compose-parent',
        _lockSessionId: expect.stringMatching(/^compose-/),
      }),
    );
    expect(db.releaseDeployLock).toHaveBeenCalledWith(
      'compose-parent',
      expect.stringMatching(/^compose-/),
    );
  });

  it('reuses an outer deployment lock without releasing it', async () => {
    const db = createLockingDb();
    const pipeline = new ComposePipeline({} as Docker, db as unknown as Database, new EventBus());
    vi.spyOn(pipeline, 'deployComposeViaDockerode').mockResolvedValue(
      successfulResult('compose-parent'),
    );

    await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/compose-app',
      clonePath: '/tmp/compose-app',
      composePath: '/tmp/compose-app/compose.yml',
      _parentId: 'compose-parent',
      _lockSessionId: 'plan-engine-session',
    });

    expect(db.acquireDeployLock).not.toHaveBeenCalled();
    expect(db.releaseDeployLock).not.toHaveBeenCalled();
  });

  it('holds the lock before a background Compose start is returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openlander-compose-lock-'));
    tempDirs.push(dir);
    const composePath = join(dir, 'compose.yml');
    writeFileSync(composePath, 'services:\n  web:\n    image: nginx:latest\n', 'utf8');
    const db = createLockingDb();
    const pipeline = new ComposePipeline({} as Docker, db as unknown as Database, new EventBus());
    let finishDeploy: ((result: ComposeDeployResult) => void) | undefined;
    vi.spyOn(pipeline, 'deployCompose').mockReturnValue(
      new Promise((resolve) => {
        finishDeploy = resolve;
      }),
    );

    const started = await pipeline.startComposeDeploy({
      repoUrl: 'https://github.com/example/compose-app',
      clonePath: dir,
      composePath,
      name: 'compose-app',
    });

    expect(db.acquireDeployLock).toHaveBeenCalledWith(
      started.parentProjectId,
      expect.stringMatching(/^compose-/),
    );
    expect(db.releaseDeployLock).not.toHaveBeenCalled();

    finishDeploy?.(successfulResult(started.parentProjectId));
    await vi.waitFor(() => {
      expect(db.releaseDeployLock).toHaveBeenCalledWith(
        started.parentProjectId,
        expect.stringMatching(/^compose-/),
      );
    });
  });

  it('rejects a top-level Compose deployment when another operation owns the lock', async () => {
    const db = createLockingDb({ contention: true });
    const pipeline = new ComposePipeline({} as Docker, db as unknown as Database, new EventBus());
    const inner = vi.spyOn(pipeline, 'deployComposeViaDockerode');

    await expect(
      pipeline.deployCompose({
        repoUrl: 'https://github.com/example/compose-app',
        clonePath: '/tmp/compose-app',
        composePath: '/tmp/compose-app/compose.yml',
        _parentId: 'compose-parent',
      }),
    ).rejects.toBeInstanceOf(DeployLockedError);

    expect(inner).not.toHaveBeenCalled();
    expect(db.releaseDeployLock).not.toHaveBeenCalled();
  });
});
