/**
 * Phase 4 validation — Blocker 2 fix
 *
 * Asserts that POST /api/settings/notifications/webhook refuses
 * loopback / link-local / RFC1918 / cloud-metadata hosts and non-http(s)
 * schemes, and that GET masks any userinfo embedded in a previously-
 * stored URL.
 *
 * The Database is mocked so the test does not depend on the
 * `settings` table being migrated (this fix only touches the route
 * layer's URL validation + redaction).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../src/app.js';
import { createNotificationsRoutes } from '../src/web/api/notifications-routes.js';

interface SettingsRow {
  value: string;
}

function createCtx(): { ctx: AppContext; store: Map<string, string> } {
  const store = new Map<string, string>();
  const ctx = {
    db: {
      getSetting: vi.fn((key: string): SettingsRow | null => {
        const value = store.get(key);
        return value === undefined ? null : { value };
      }),
      upsertSetting: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
      deleteSetting: vi.fn((key: string) => {
        store.delete(key);
      }),
    },
  } as unknown as AppContext;
  return { ctx, store };
}

describe('notifications webhook — SSRF guard + userinfo redaction (Blocker 2)', () => {
  let app: Hono;
  let store: Map<string, string>;

  beforeEach(() => {
    const { ctx, store: s } = createCtx();
    store = s;
    app = new Hono();
    app.route('/api', createNotificationsRoutes(ctx));
  });

  describe('POST refuses unsafe URLs', () => {
    const cases: Array<[string, string]> = [
      ['file:///etc/passwd', 'file scheme'],
      ['javascript:alert(1)', 'javascript scheme'],
      ['http://169.254.169.254/latest/meta-data/', 'cloud metadata IP'],
      ['http://localhost:9000/admin', 'localhost'],
      ['http://127.0.0.1/foo', 'loopback IPv4'],
      ['http://10.0.0.1/foo', 'RFC1918 10/8'],
      ['http://192.168.1.1/foo', 'RFC1918 192.168/16'],
      ['https://my.local/foo', 'mDNS *.local'],
      ['ftp://example.com/foo', 'non-http(s) scheme'],
    ];

    for (const [url, label] of cases) {
      it(`returns 400 for ${label} (${url})`, async () => {
        const res = await app.request('/api/settings/notifications/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, events: ['deploy.success'] }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; message: string };
        expect(body.error).toBe('INVALID_FIELD');
        expect(body.message).toContain('not a safe webhook target');
      });
    }
  });

  it('POST accepts a valid public https URL', async () => {
    const res = await app.request('/api/settings/notifications/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://hooks.example.com/services/abc',
        events: ['deploy.success', 'deploy.failure'],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; events: string[] };
    expect(body.url).toBe('https://hooks.example.com/services/abc');
    expect(body.events).toEqual(['deploy.success', 'deploy.failure']);
  });

  it('POST refuses URLs with embedded credentials (user:pass@)', async () => {
    const res = await app.request('/api/settings/notifications/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://user:pass@hooks.example.com/path',
        events: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('GET redacts userinfo from a previously-stored webhook URL', async () => {
    // Simulate a legacy row with embedded credentials. (POST refuses
    // these now — the redactor protects values stored before the SSRF
    // guard landed.)
    store.set(
      'notification_webhook',
      JSON.stringify({
        url: 'https://user:pass@hooks.example.com/path?x=1',
        events: ['deploy.success'],
      }),
    );

    const res = await app.request('/api/settings/notifications/webhook');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://hooks.example.com/path?x=1');
    expect(body.url).not.toContain('user');
    expect(body.url).not.toContain('pass');
  });

  it('GET passes through a clean URL unchanged', async () => {
    store.set(
      'notification_webhook',
      JSON.stringify({
        url: 'https://hooks.example.com/path',
        events: [],
      }),
    );

    const res = await app.request('/api/settings/notifications/webhook');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe('https://hooks.example.com/path');
  });
});
