import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  limited: boolean;
  retryAfterSec: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Per-process, in-memory fixed-window rate limiter. Sufficient for a self-hosted
 * single-instance 0.1 deployment — no external store (Redis etc.). Keyed by the
 * caller (IP) + route by the call site, e.g. `login:1.2.3.4`. State is process-local,
 * so it resets on restart; that is acceptable for slowing credential brute force.
 */
const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5000;

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    pruneIfLarge(now);
    return { limited: false, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function pruneIfLarge(now: number): void {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/**
 * Client identity for rate-limit keying, resistant to header spoofing.
 *
 * The socket peer address is the source of truth. `X-Forwarded-For` is honored ONLY
 * when the immediate peer is a local/private address — i.e. the managed Traefik proxy on
 * the same host/docker network. On a direct `:10114` hit the peer IS the real client, so
 * we key on its socket address and ignore the (spoofable) forwarded headers. This avoids
 * both a shared `unknown` bucket (global lockout) and header-spoof bypass of the limiter.
 */
export function clientIp(c: Context): string {
  let socketIp = '';
  try {
    socketIp = getConnInfo(c).remote.address ?? '';
  } catch {
    socketIp = '';
  }
  if (socketIp && isTrustedProxyAddress(socketIp)) {
    const forwarded = forwardedClient(c);
    if (forwarded) return forwarded;
  }
  return socketIp || forwardedClient(c) || 'unknown';
}

function forwardedClient(c: Context): string | undefined {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return c.req.header('x-real-ip')?.trim() || undefined;
}

// Loopback / RFC1918 / link-local / IPv6 ULA — treated as a trusted local proxy hop.
function isTrustedProxyAddress(ip: string): boolean {
  const addr = ip.replace(/^::ffff:/i, '').toLowerCase();
  return (
    addr === '::1' ||
    addr === 'localhost' ||
    addr.startsWith('127.') ||
    addr.startsWith('10.') ||
    addr.startsWith('192.168.') ||
    addr.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ||
    addr.startsWith('fc') ||
    addr.startsWith('fd')
  );
}

/** Test-only: clear all tracked buckets between cases. */
export function __resetRateLimit(): void {
  buckets.clear();
}
