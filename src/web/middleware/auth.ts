import type { Context, Next } from 'hono';
import type { AuthService } from '../../auth/auth-service.js';
import { parseCookie } from './cookies.js';

const EXEMPT_PREFIXES = [
  '/api/webhooks/',
  '/webhooks/',
  '/auth/',
  '/api/auth/',
  '/assets/',
  '/mcp',
  '/api/traefik/',
];

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

export function createAuthMiddleware(authService: AuthService) {
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    const method = c.req.method;

    if (path === '/health') {
      return next();
    }

    for (const prefix of EXEMPT_PREFIXES) {
      if (path.startsWith(prefix)) {
        return next();
      }
    }

    for (const ext of EXEMPT_EXTENSIONS) {
      if (path.endsWith(ext)) {
        return next();
      }
    }

    if (method === 'GET' && path === '/api/setup/status') {
      return next();
    }

    if (!authService.isPasswordSet()) {
      if (path.startsWith('/api/setup/') || path.startsWith('/setup')) {
        return next();
      }
      if (!path.startsWith('/api/')) {
        return next();
      }
      return c.json({ error: 'SETUP_REQUIRED' }, 403);
    }

    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = parseCookie(cookieHeader, 'ol_session');
    if (sessionToken && authService.validateSession(sessionToken)) {
      return next();
    }

    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (authService.validateApiToken(token)) {
        return next();
      }
    }

    if (!path.startsWith('/api/')) {
      return next();
    }

    return c.json({ error: 'Unauthorized' }, 401);
  };
}
