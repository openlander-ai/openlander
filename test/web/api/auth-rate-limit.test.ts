import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthRoutes } from '../../../src/web/api/auth-routes.js';
import { __resetRateLimit } from '../../../src/web/middleware/rate-limit.js';

function createHarness() {
  const authService = {
    isPasswordSet: vi.fn(async () => true),
    getAuth: vi.fn(async () => ({ password_hash: 'stored-hash' })),
    verifyPassword: vi.fn(() => false), // always wrong → 401, never short-circuits the limiter
    createSession: vi.fn(async () => ({ token: 'sess', expiresAt: Date.now() + 3600_000 })),
  } as unknown as AuthService;
  const app = createAuthRoutes(authService, {} as AppContext);
  return { app };
}

function loginAttempt(app: ReturnType<typeof createHarness>['app'], ip: string) {
  return app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
}

describe('auth login rate limit', () => {
  beforeEach(() => {
    __resetRateLimit();
  });

  it('allows up to the max attempts, then returns 429 with Retry-After', async () => {
    const { app } = createHarness();
    const ip = '203.0.113.7';

    for (let i = 0; i < 10; i++) {
      const res = await loginAttempt(app, ip);
      expect(res.status).toBe(401); // wrong password, still under the limit
    }

    const limited = await loginAttempt(app, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    await expect(limited.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('tracks the limit per client IP', async () => {
    const { app } = createHarness();

    for (let i = 0; i < 11; i++) {
      await loginAttempt(app, '203.0.113.8');
    }

    // A different IP is unaffected by another IP hitting the limit.
    const other = await loginAttempt(app, '203.0.113.9');
    expect(other.status).toBe(401);
  });

  it('rate-limits setup-password too', async () => {
    const { app } = createHarness();
    const ip = '203.0.113.10';
    const attempt = () =>
      app.request('/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ password: 'whatever' }),
      });

    for (let i = 0; i < 10; i++) {
      const res = await attempt();
      expect(res.status).not.toBe(429); // under the limit (403 already-configured here)
    }

    const limited = await attempt();
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
