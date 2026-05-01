/**
 * Shared CORS origin policy for OpenLander HTTP/MCP surfaces.
 *
 * Security model:
 * - Default (no `corsOrigin` config) is **same-origin only** — only requests
 *   whose `Origin` matches `server.baseUrl` are allowed. This protects against
 *   cross-origin theft of project metadata, env vars, deploy logs, and terminal
 *   output by any random website the user visits.
 * - Operators can opt in to additional origins via `server.corsOrigin`
 *   (comma-separated list) — typically the production web UI host(s) when the
 *   API is fronted by a separate domain.
 * - Requests with a missing/null `Origin` header (curl, server-to-server) are
 *   denied by the browser-CORS contract — these clients should authenticate
 *   directly and do not need CORS headers.
 */

import type { Context } from 'hono';

export type CorsOriginResolver = (origin: string, c: Context) => string | null;

/**
 * Parse a comma-separated origin allow-list, trimming whitespace and dropping
 * empties. Returns an empty array when input is undefined/empty/whitespace.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build a CORS `origin` callback that enforces the OpenLander policy.
 *
 * @param corsOrigin - operator-supplied allow-list (comma-separated) or empty
 * @param baseUrl    - server base URL used as the same-origin default
 */
export function createCorsOriginPolicy(
  corsOrigin: string | undefined,
  baseUrl: string | undefined,
): CorsOriginResolver {
  const allowed = parseAllowedOrigins(corsOrigin);
  const baseOrigin = normalizeOrigin(baseUrl ?? '');

  return (origin: string): string | null => {
    if (!origin) {
      // Browser CORS spec: no Origin header → no preflight needed and no
      // ACAO header should be sent. Returning null tells Hono to omit the
      // header, which is the safe default.
      return null;
    }
    if (allowed.length === 0) {
      // Default policy: same-origin only.
      return origin === baseOrigin ? origin : null;
    }
    return allowed.includes(origin) ? origin : null;
  };
}

/**
 * Normalize a base URL into the canonical `Origin` form (scheme + host + port).
 * Falls back to the raw value if URL parsing fails so misconfigured operators
 * still get a deterministic comparison key.
 */
function normalizeOrigin(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return baseUrl;
  }
}
