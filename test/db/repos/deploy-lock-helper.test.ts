import { describe, it, expect, vi } from 'vitest';

import {
  acquireDeployLockOrThrow,
  withDeployLock,
} from '../../../src/db/repos/deploy-lock-helper.js';
import { DeployLockedError } from '../../../src/errors.js';

type LockDb = Parameters<typeof withDeployLock>[0];

function createDb(opts: { acquired: boolean; lockSession?: string }): LockDb & {
  acquireDeployLock: ReturnType<typeof vi.fn>;
  releaseDeployLock: ReturnType<typeof vi.fn>;
  getDeployLockInfo: ReturnType<typeof vi.fn>;
} {
  return {
    acquireDeployLock: vi.fn().mockReturnValue(opts.acquired),
    releaseDeployLock: vi.fn(),
    getDeployLockInfo: vi
      .fn()
      .mockReturnValue(opts.lockSession ? { session: opts.lockSession, lockedAt: 'now' } : null),
  };
}

describe('withDeployLock', () => {
  it('acquires lock, runs fn, then releases lock', async () => {
    const db = createDb({ acquired: true });
    const fn = vi.fn().mockResolvedValue('result');

    const result = await withDeployLock(db, { projectId: 'p1', sessionId: 's1' }, fn);

    expect(result).toBe('result');
    expect(db.acquireDeployLock).toHaveBeenCalledWith('p1', 's1');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(db.releaseDeployLock).toHaveBeenCalledWith('p1', 's1');

    // Order: acquire → fn → release
    const acquireOrder = db.acquireDeployLock.mock.invocationCallOrder[0];
    const fnOrder = fn.mock.invocationCallOrder[0];
    const releaseOrder = db.releaseDeployLock.mock.invocationCallOrder[0];
    expect(acquireOrder).toBeLessThan(fnOrder);
    expect(fnOrder).toBeLessThan(releaseOrder);
  });

  it('throws DeployLockedError when lock acquisition fails', async () => {
    const db = createDb({ acquired: false, lockSession: 'other-session' });
    const fn = vi.fn();

    await expect(
      withDeployLock(db, { projectId: 'p1', sessionId: 's1' }, fn),
    ).rejects.toBeInstanceOf(DeployLockedError);

    expect(fn).not.toHaveBeenCalled();
    expect(db.releaseDeployLock).not.toHaveBeenCalled();
  });

  it('includes lock holder session in DeployLockedError details', async () => {
    const db = createDb({ acquired: false, lockSession: 'holder-session' });

    try {
      await withDeployLock(db, { projectId: 'p1', sessionId: 's1' }, async () => undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DeployLockedError);
      expect((err as DeployLockedError).details).toMatchObject({
        projectId: 'p1',
        lockedBySession: 'holder-session',
      });
    }
  });

  it('falls back to "unknown" lock holder when getDeployLockInfo returns null', async () => {
    const db = createDb({ acquired: false });

    try {
      await withDeployLock(db, { projectId: 'p1', sessionId: 's1' }, async () => undefined);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DeployLockedError);
      expect((err as DeployLockedError).details).toMatchObject({
        projectId: 'p1',
        lockedBySession: 'unknown',
      });
    }
  });

  it('releases the lock when fn throws', async () => {
    const db = createDb({ acquired: true });
    const failure = new Error('boom');
    const fn = vi.fn().mockRejectedValue(failure);

    await expect(withDeployLock(db, { projectId: 'p1', sessionId: 's1' }, fn)).rejects.toBe(
      failure,
    );

    expect(db.releaseDeployLock).toHaveBeenCalledWith('p1', 's1');
  });

  it('invokes onContention callback when supplied and lock is unavailable', async () => {
    const db = createDb({ acquired: false, lockSession: 'other-session' });
    const customError = new Error('custom contention');
    const onContention = vi.fn(((_lockedBy: string) => {
      throw customError;
    }) as (lockedBy: string) => never);

    await expect(
      withDeployLock(db, { projectId: 'p1', sessionId: 's1', onContention }, async () => undefined),
    ).rejects.toBe(customError);

    expect(onContention).toHaveBeenCalledWith('other-session');
    expect(db.releaseDeployLock).not.toHaveBeenCalled();
  });
});

describe('acquireDeployLockOrThrow', () => {
  it('returns silently when acquisition succeeds', () => {
    const db = createDb({ acquired: true });
    expect(() => acquireDeployLockOrThrow(db, { projectId: 'p1', sessionId: 's1' })).not.toThrow();
    expect(db.acquireDeployLock).toHaveBeenCalledWith('p1', 's1');
  });

  it('throws DeployLockedError when acquisition fails', () => {
    const db = createDb({ acquired: false, lockSession: 'other' });
    expect(() => acquireDeployLockOrThrow(db, { projectId: 'p1', sessionId: 's1' })).toThrow(
      DeployLockedError,
    );
  });

  it('honours onContention when supplied', () => {
    const db = createDb({ acquired: false, lockSession: 'holder' });
    const customError = new Error('custom');
    const onContention = vi.fn(((_holder: string) => {
      throw customError;
    }) as (lockedBy: string) => never);

    expect(() =>
      acquireDeployLockOrThrow(db, { projectId: 'p1', sessionId: 's1', onContention }),
    ).toThrow(customError);
    expect(onContention).toHaveBeenCalledWith('holder');
  });
});
