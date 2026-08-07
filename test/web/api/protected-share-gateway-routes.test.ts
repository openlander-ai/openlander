import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../../src/app.js';
import type { ProjectRow, ServiceRow } from '../../../src/db/index.js';
import { createProtectedShareGatewayRoutes } from '../../../src/web/api/protected-share-gateway-routes.js';
import { __resetRateLimit } from '../../../src/web/middleware/rate-limit.js';

const target = {
  project: { id: 'project-1', name: 'demo' } as ProjectRow,
  service: {
    id: 'service-web',
    project_id: 'project-1',
    name: 'web',
    access_code: 'hash',
    access_code_iv: 'secret',
    visibility: 'shared',
  } as ServiceRow,
};

function harness(options?: { validCode?: boolean; validSession?: boolean }) {
  const publicShare = {
    resolveActiveShareByHostname: vi.fn(async (hostname: string) =>
      hostname === 'demo.34-64-12-34.sslip.io' ? target : null,
    ),
    validateSessionToken: vi.fn(() => options?.validSession === true),
    verifyAccessCode: vi.fn(() => options?.validCode === true),
    createSessionToken: vi.fn(() => 'signed-session-token'),
  };
  const app = new Hono();
  app.route('/', createProtectedShareGatewayRoutes({ publicShare } as unknown as AppContext));
  return { app, publicShare };
}

describe('protected share visitor gateway', () => {
  beforeEach(() => __resetRateLimit());

  it('renders the access-code gate in the visitor language without exposing the app', async () => {
    const { app } = harness();
    const response = await app.request('/__openlander/share/auth', {
      headers: {
        'X-Forwarded-Host': 'demo.34-64-12-34.sslip.io',
        'X-Forwarded-Uri': '/dashboard?tab=one',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('OpenLander 보호 공유');
    expect(html).toContain('<h1>demo</h1>');
    expect(html).toContain('공유 코드를 입력하면 앱을 열 수 있습니다.');
    expect(html).toContain('>앱 열기</button>');
    expect(html).toContain('name="access_code"');
    expect(html).toContain('value="/dashboard?tab=one"');
    expect(html).toContain('color-scheme:light');
    expect(html).not.toContain('radial-gradient');
    expect(html).not.toContain('hash');
  });

  it('connects an invalid share-code error to the input', async () => {
    const { app } = harness({ validCode: false });
    const response = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=AAAA-BBBB',
    });

    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="access-code-error"');
    expect(html).toContain('id="access-code-error"');
    expect(html).toContain('That share code is not valid.');
  });

  it('redirects direct visits to the internal verification endpoint back to the gate', async () => {
    const { app } = harness();
    const response = await app.request('/__openlander/share/verify', {
      headers: { Host: 'demo.34-64-12-34.sslip.io' },
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts an opaque origin only for a browser-controlled same-origin navigation', async () => {
    const { app } = harness({ validCode: false });
    const sameOriginNavigation = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        Origin: 'null',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=AAAA-BBBB',
    });
    const crossSiteNavigation = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        Origin: 'null',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=AAAA-BBBB',
    });

    expect(sameOriginNavigation.status).toBe(401);
    expect(await sameOriginNavigation.text()).toContain('That share code is not valid.');
    expect(crossSiteNavigation.status).toBe(403);
  });

  it('allows on-demand TLS only for an active protected-share hostname', async () => {
    const { app, publicShare } = harness();

    const allowed = await app.request(
      '/__openlander/share/tls-allow?domain=demo.34-64-12-34.sslip.io',
    );
    const denied = await app.request(
      '/__openlander/share/tls-allow?domain=unknown.34-64-12-34.sslip.io',
    );

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('cache-control')).toBe('no-store');
    expect(denied.status).toBe(404);
    expect(publicShare.resolveActiveShareByHostname).toHaveBeenNthCalledWith(
      1,
      'demo.34-64-12-34.sslip.io',
    );
  });

  it('sets a Secure host-only cookie and redirects to a safe same-host path', async () => {
    const { app, publicShare } = harness({ validCode: true });
    const response = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        Origin: 'https://demo.34-64-12-34.sslip.io',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=ABCD-EFGH&next=%2Fdashboard',
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard');
    expect(response.headers.get('set-cookie')).toContain(
      'ol_share=signed-session-token; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(publicShare.verifyAccessCode).toHaveBeenCalledWith(target.service, 'ABCD-EFGH');

    const backslashRedirect = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        Origin: 'https://demo.34-64-12-34.sslip.io',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=ABCD-EFGH&next=%2F%5C%5Cattacker.example',
    });
    expect(backslashRedirect.status).toBe(303);
    expect(backslashRedirect.headers.get('location')).toBe('/');
  });

  it('allows Traefik to continue only when the host-bound session is valid', async () => {
    const { app, publicShare } = harness({ validSession: true });
    const response = await app.request('/__openlander/share/auth', {
      headers: {
        'X-Forwarded-Host': 'demo.34-64-12-34.sslip.io',
        Cookie: 'ol_share=signed-session-token',
      },
    });

    expect(response.status).toBe(204);
    expect(publicShare.validateSessionToken).toHaveBeenCalledWith(
      target.service,
      'demo.34-64-12-34.sslip.io',
      'signed-session-token',
    );
  });

  it('rejects cross-origin code submission and rate-limits repeated guesses', async () => {
    const { app } = harness({ validCode: false });
    const crossOrigin = await app.request('/__openlander/share/verify', {
      method: 'POST',
      headers: {
        Host: 'demo.34-64-12-34.sslip.io',
        Origin: 'https://attacker.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'access_code=AAAA-BBBB',
    });
    expect(crossOrigin.status).toBe(403);

    let response: Response | null = null;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      response = await app.request('/__openlander/share/verify', {
        method: 'POST',
        headers: {
          Host: 'demo.34-64-12-34.sslip.io',
          'X-Forwarded-For': '203.0.113.7',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'access_code=AAAA-BBBB',
      });
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBeTruthy();
  });
});
