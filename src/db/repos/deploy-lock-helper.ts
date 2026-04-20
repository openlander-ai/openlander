/**
 * Helper that wraps a function with deploy-lock acquire/release semantics.
 *
 * Replaces the duplicated try/acquire/finally/release pattern that previously
 * lived in `deploy-core.ts`, `deploy-plan/engine.ts`, and the MCP `tools/defs/`
 * surface. Always pair with the pipeline boundary policy (`assertProjectMutable`)
 * in `src/pipeline/mutation-policy.ts`.
 */
import type { Database } from '../index.js';
import { DeployLockedError } from '../../errors.js';

export interface DeployLockOptions {
  projectId: string;
  sessionId: string;
  /**
   * Optional override invoked when the lock cannot be acquired. The callback
   * MUST throw (its return type is `never`) — typically used to surface a
   * caller-specific error instead of `DeployLockedError`.
   */
  onContention?: (lockedBySession: string) => never;
}

/**
 * Acquire the project deploy lock or throw `DeployLockedError` (or whatever
 * `onContention` throws) when the lock is held by a different session.
 *
 * Use this when the release lifecycle cannot be wrapped in try/finally — for
 * example, when an async event listener releases the lock after the call
 * returns. Prefer `withDeployLock` whenever possible.
 */
export function acquireDeployLockOrThrow(
  db: Pick<Database, 'acquireDeployLock' | 'getDeployLockInfo'>,
  opts: DeployLockOptions,
): void {
  const acquired = db.acquireDeployLock(opts.projectId, opts.sessionId);
  if (acquired) {
    return;
  }

  const lockInfo = db.getDeployLockInfo(opts.projectId);
  const lockedBy = lockInfo?.session ?? 'unknown';
  if (opts.onContention) {
    opts.onContention(lockedBy);
  }
  throw new DeployLockedError(opts.projectId, lockedBy);
}

/**
 * Acquire the project deploy lock, run `fn`, and release the lock in `finally`.
 *
 * Throws `DeployLockedError` (or whatever `onContention` throws) when the lock
 * is already held by a different session.
 */
export async function withDeployLock<T>(
  db: Pick<Database, 'acquireDeployLock' | 'releaseDeployLock' | 'getDeployLockInfo'>,
  opts: DeployLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  acquireDeployLockOrThrow(db, opts);

  try {
    return await fn();
  } finally {
    db.releaseDeployLock(opts.projectId, opts.sessionId);
  }
}
