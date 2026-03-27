import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { Database } from '../../src/db/index.js';
import { Agent } from '../../src/llm/agent.js';
import { AgentPool, MAX_POOL_SIZE } from '../../src/llm/agent-pool.js';

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
