/**
 * Deterministic pseudo-random number series — stable across renders for
 * a given `seed`. Used by Sparkline charts in the prototype monitoring
 * tab.
 *
 * Replace with real metrics fetches when the monitoring endpoint lands.
 */
export function deterministicSeries(seed: string, n: number, base: number, amp: number): number[] {
  let s = 0;
  for (const c of seed) s = ((s * 31 + c.charCodeAt(0)) >>> 0) | 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    const r = (s & 0xffff) / 0xffff;
    const wave = Math.sin(i / 5) * 0.4 + Math.cos(i / 11) * 0.3;
    out.push(base + (wave + (r - 0.5)) * amp);
  }
  return out;
}
