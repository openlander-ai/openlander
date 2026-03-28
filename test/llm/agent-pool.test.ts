import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { Database } from '../../src/db/index.js';
import { Agent } from '../../src/llm/agent.js';
import { AgentPool, MAX_POOL_SIZE, PROJECT_LOCK_TIMEOUT_MS } from '../../src/llm/agent-pool.js';

function createPool(): AgentPool {
  const model = {} as unknown as LanguageModel;
  const db = {} as unknown as Database;
  return new AgentPool(model, db);
}

describe('AgentPool', () => {
  it('getOrCreate returns an Agent instance', () => {
    const pool = createPool();
    const agent = pool.getOrCreate('s1');

    expect(agent).toBeInstanceOf(Agent);
  });

  it('reuses the same Agent for the same session', () => {
    const pool = createPool();
    const first = pool.getOrCreate('s1');
    const second = pool.getOrCreate('s1');

    expect(second).toBe(first);
  });

  it('creates different Agent instances for different sessions', () => {
    const pool = createPool();
    const s1 = pool.getOrCreate('s1');
    const s2 = pool.getOrCreate('s2');

    expect(s1).not.toBe(s2);
  });

  it('evicts the oldest idle session by LRU when pool is full', () => {
    vi.useFakeTimers();
    try {
      const pool = createPool();
      const s1 = pool.getOrCreate('s1');
      pool.getOrCreate('s2');
      pool.getOrCreate('s3');
      pool.getOrCreate('s4');
      pool.getOrCreate('s5');
      expect(pool.getStats().total).toBe(MAX_POOL_SIZE);

      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      pool.release('s1');
      vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
      pool.release('s2');

      pool.getOrCreate('s6');

      const s1AfterEviction = pool.getOrCreate('s1');
      expect(s1AfterEviction).not.toBe(s1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getRecoveryAgent returns a dedicated Agent separate from pool sessions', () => {
    const pool = createPool();
    const sessionAgent = pool.getOrCreate('s1');
    const recoveryFirst = pool.getRecoveryAgent();
    const recoverySecond = pool.getRecoveryAgent();

    expect(recoveryFirst).toBe(recoverySecond);
    expect(recoveryFirst).not.toBe(sessionAgent);
    expect(pool.getStats().total).toBe(1);
  });

  it('getStats returns active/idle/total counts', () => {
    const pool = createPool();
    pool.getOrCreate('s1');
    pool.getOrCreate('s2');
    pool.release('s1');

    expect(pool.getStats()).toEqual({
      active: 1,
      idle: 1,
      total: 2,
    });
  });

  it('invalidateAll clears all pooled sessions', () => {
    const pool = createPool();
    pool.getOrCreate('s1');
    pool.getOrCreate('s2');
    pool.getRecoveryAgent();

    pool.invalidateAll();

    expect(pool.getStats()).toEqual({
      active: 0,
      idle: 0,
      total: 0,
    });

    const recoveryAfterInvalidate = pool.getRecoveryAgent();
    expect(recoveryAfterInvalidate).toBeInstanceOf(Agent);
  });
});

describe('AgentPool - Project Locking', () => {
  it('acquireProjectLock returns true for first acquisition', () => {
    const pool = createPool();
    expect(pool.acquireProjectLock('p1', 'session-A')).toBe(true);
  });

  it('acquireProjectLock returns false when project already locked by another session', () => {
    const pool = createPool();
    pool.acquireProjectLock('p1', 'session-A');
    expect(pool.acquireProjectLock('p1', 'session-B')).toBe(false);
  });

  it('releaseProjectLock allows subsequent acquisition', () => {
    const pool = createPool();
    pool.acquireProjectLock('p1', 'session-A');
    pool.releaseProjectLock('p1', 'session-A');
    expect(pool.acquireProjectLock('p1', 'session-B')).toBe(true);
  });

  it('releaseProjectLock is no-op for wrong session', () => {
    const pool = createPool();
    pool.acquireProjectLock('p1', 'session-A');
    pool.releaseProjectLock('p1', 'session-B'); // wrong session
    expect(pool.acquireProjectLock('p1', 'session-B')).toBe(false); // still locked
  });

  it('stale locks are evicted on next acquisition attempt', () => {
    vi.useFakeTimers();
    try {
      const pool = createPool();
      // Manually set a stale lock
      (pool as unknown as { projectLocks: Map<string, unknown> }).projectLocks.set('p1', {
        sessionId: 'old-session',
        startedAt: Date.now() - PROJECT_LOCK_TIMEOUT_MS - 1,
      });

      // Should succeed because the lock is stale
      expect(pool.acquireProjectLock('p1', 'session-B')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('different projects can be locked simultaneously', () => {
    const pool = createPool();
    expect(pool.acquireProjectLock('p1', 'session-A')).toBe(true);
    expect(pool.acquireProjectLock('p2', 'session-B')).toBe(true);
  });

  it('getProjectLock returns null when no lock exists', () => {
    const pool = createPool();
    expect(pool.getProjectLock('p1')).toBeNull();
  });

  it('getProjectLock returns lock info when lock is held', () => {
    const pool = createPool();
    pool.acquireProjectLock('p1', 'session-A');
    const lock = pool.getProjectLock('p1');
    expect(lock).not.toBeNull();
    expect(lock?.sessionId).toBe('session-A');
    expect(typeof lock?.startedAt).toBe('number');
  });

  it('getProjectLock evicts stale locks', () => {
    vi.useFakeTimers();
    try {
      const pool = createPool();
      // Manually set a stale lock
      (pool as unknown as { projectLocks: Map<string, unknown> }).projectLocks.set('p1', {
        sessionId: 'old-session',
        startedAt: Date.now() - PROJECT_LOCK_TIMEOUT_MS - 1,
      });

      // Should return null and evict the stale lock
      expect(pool.getProjectLock('p1')).toBeNull();
      // Verify it was evicted
      expect(pool.getProjectLock('p1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('executeWithProjectLock acquires lock, executes function, and releases lock', async () => {
    const pool = createPool();
    let executed = false;

    const result = await pool.executeWithProjectLock('session-A', 'p1', async () => {
      executed = true;
      return 'success';
    });

    expect(executed).toBe(true);
    expect(result).toBe('success');
    // Lock should be released
    expect(pool.acquireProjectLock('p1', 'session-B')).toBe(true);
  });

  it('executeWithProjectLock returns error when project is busy', async () => {
    const pool = createPool();
    pool.acquireProjectLock('p1', 'session-A');

    const result = await pool.executeWithProjectLock('session-B', 'p1', async () => {
      return 'should not execute';
    });

    expect(result).toEqual({
      error: 'project_busy',
      sessionId: 'session-A',
      message: expect.stringContaining('Project p1 has an ongoing operation'),
    });
  });

  it('executeWithProjectLock releases lock even if function throws', async () => {
    const pool = createPool();

    try {
      await pool.executeWithProjectLock('session-A', 'p1', async () => {
        throw new Error('test error');
      });
    } catch {
      // Expected
    }

    // Lock should be released
    expect(pool.acquireProjectLock('p1', 'session-B')).toBe(true);
  });
});
