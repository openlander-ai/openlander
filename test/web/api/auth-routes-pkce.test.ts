import { afterEach, describe, expect, it } from 'vitest';

import { __pkceTestHooks } from '../../../src/web/api/auth-routes.js';

/**
 * Day 12 (MAJOR #4): the OAuth PKCE verifier map is in-process state with a
 * 10-minute TTL. Without a hard size cap an attacker hitting `/auth/google
 * /start` faster than the TTL sweep can DoS the server by exhausting heap.
 *
 * The new `setPkceVerifierWithCap` helper:
 *  - keeps the map size at or below `PKCE_STATE_MAX_ENTRIES` (100)
 *  - evicts the oldest insertion-order entry when the cap is reached
 *  - still allows new entries to land (legitimate concurrent OAuth bursts
 *    must not be punished for being adjacent to a flood)
 */
describe('Day 12 MAJOR #4: pkceVerifiersByState size cap', () => {
  afterEach(() => {
    __pkceTestHooks.clear();
  });

  it('exposes a sane max entry constant', () => {
    expect(__pkceTestHooks.maxEntries).toBeGreaterThan(0);
    expect(__pkceTestHooks.maxEntries).toBeLessThanOrEqual(1000);
  });

  it('keeps the map at or below the configured cap when flooded', () => {
    const flood = __pkceTestHooks.maxEntries + 50;
    for (let i = 0; i < flood; i++) {
      __pkceTestHooks.set(`state-${String(i)}`, {
        verifier: `verifier-${String(i)}`,
        createdAt: Date.now() + i,
      });
    }

    expect(__pkceTestHooks.size).toBeLessThanOrEqual(__pkceTestHooks.maxEntries);
  });

  it('evicts the oldest entry once the cap is reached so newest survives', () => {
    const cap = __pkceTestHooks.maxEntries;

    // Fill up to cap.
    for (let i = 0; i < cap; i++) {
      __pkceTestHooks.set(`state-${String(i)}`, {
        verifier: `verifier-${String(i)}`,
        createdAt: Date.now() + i,
      });
    }
    expect(__pkceTestHooks.size).toBe(cap);
    expect(__pkceTestHooks.has('state-0')).toBe(true);

    // One more push should evict the very first entry.
    __pkceTestHooks.set('state-overflow', {
      verifier: 'verifier-overflow',
      createdAt: Date.now() + cap,
    });

    expect(__pkceTestHooks.size).toBe(cap);
    expect(__pkceTestHooks.has('state-0')).toBe(false);
    expect(__pkceTestHooks.has('state-overflow')).toBe(true);
  });

  it('still admits the (cap+1)th legitimate state without rejecting', () => {
    const cap = __pkceTestHooks.maxEntries;

    for (let i = 0; i < cap; i++) {
      __pkceTestHooks.set(`state-${String(i)}`, {
        verifier: `verifier-${String(i)}`,
        createdAt: Date.now() + i,
      });
    }

    // No throw, no reject — caller behaviour stays "set succeeds".
    expect(() =>
      __pkceTestHooks.set('next', { verifier: 'verifier-next', createdAt: Date.now() }),
    ).not.toThrow();

    expect(__pkceTestHooks.has('next')).toBe(true);
  });
});
