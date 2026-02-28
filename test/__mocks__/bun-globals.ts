/**
 * Bun globals shim for Vitest/Node.
 *
 * The production runtime (Bun) provides `globalThis.Bun` natively.
 * Under Vitest (Node.js), it doesn't exist — this stub provides
 * a minimal surface so tests can vi.spyOn(Bun, 'spawn') without
 * ReferenceError.
 */

if (typeof globalThis.Bun === 'undefined') {
  (globalThis as Record<string, unknown>).Bun = {
    spawn: (() => {
      throw new Error('Bun.spawn stub — mock this in your test');
    }) as unknown,
  };
}
