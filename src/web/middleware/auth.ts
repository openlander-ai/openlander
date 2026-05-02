import type { Context, Next } from 'hono';
import type { AuthService } from '../../auth/auth-service.js';
import { parseCookie } from './cookies.js';

const EXEMPT_PREFIXES = ['/api/webhooks/', '/webhooks/', '/assets/', '/mcp', '/api/traefik/'];

// Auth endpoints that intentionally bypass session validation.
// Anything not in this list (e.g. OAuth start/callback, change-password,
// token issuance) MUST go through the normal session/API-token auth path.
const EXEMPT_AUTH_PATHS = new Set<string>([
  '/auth/login',
  '/api/auth/login',
  '/auth/logout',
  '/api/auth/logout',
  '/auth/verify',
  '/api/auth/verify',
  '/auth/setup-password',
  '/api/auth/setup-password',
]);

const EXEMPT_EXTENSIONS = [
  '.js',
  '.css',
  '.svg',
  '.ico',
  '.png',
  '.woff2',
  '.woff',
  '.ttf',
  '.map',
];

/**
 * Read the request's auth flag set by `createAuthMiddleware`. Returns false
 * for unauthenticated requests that the middleware lets through (static HTML,
 * /api/setup/status during onboarding, etc.) so handlers can mask sensitive
 * fields. Routes that require auth are already gated by the middleware itself
 * — this helper exists for endpoints that intentionally serve a
 * less-privileged response to anonymous callers (Day 13 M5).
 */
export function isAuthenticated(c: Context): boolean {
  return c.get('isAuthenticated') === true;
}

export function createAuthMiddleware(authService: AuthService) {
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    const method = c.req.method;

    // Validate session/token for *every* request so handlers can use
    // `isAuthenticated(c)` to decide whether to redact sensitive fields.
    // The flag is purely advisory — middleware below still enforces the
    // hard 401/403 for protected paths.
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = parseCookie(cookieHeader, 'ol_session');
    let authed = false;
    if (sessionToken && (await authService.validateSession(sessionToken))) {
      authed = true;
    } else {
      const authHeader = c.req.header('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (await authService.validateApiToken(token)) {
          authed = true;
        }
      }
    }
    c.set('isAuthenticated', authed);

    if (path === '/health') {
      return next();
    }

    for (const prefix of EXEMPT_PREFIXES) {
      if (path.startsWith(prefix)) {
        return next();
      }
    }

    if (EXEMPT_AUTH_PATHS.has(path)) {
      return next();
    }

    for (const ext of EXEMPT_EXTENSIONS) {
      if (path.endsWith(ext)) {
        return next();
      }
    }

    if (method === 'GET' && path === '/api/setup/status') {
      return next();
    }

    // /api/info intentionally serves a less-privileged response to anonymous
    // callers (Day 13 M5). The handler decides what to expose based on
    // `isAuthenticated(c)`. Skipping the gate here keeps that decision in
    // one place.
    if (method === 'GET' && path === '/api/info') {
      return next();
    }

    if (!(await authService.isPasswordSet())) {
      if (path.startsWith('/api/setup/') || path.startsWith('/setup')) {
        return next();
      }
      if (!path.startsWith('/api/')) {
        return next();
      }
      return c.json({ error: 'SETUP_REQUIRED' }, 403);
    }

    if (authed) {
      return next();
    }

    if (!path.startsWith('/api/')) {
      return next();
    }

    return c.json({ error: 'Unauthorized' }, 401);
  };
}
