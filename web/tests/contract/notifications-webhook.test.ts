/**
 * Contract test: notification webhook CRUD
 *   GET → 404 (not configured)
 *   POST → 200
 *   GET → 200 with parseable NotificationWebhookConfig
 *   DELETE → 200
 *   GET → 404 (cleared)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { NotificationWebhookConfigSchema } from '../../src/lib/api/notifications-zod';

const PORT_FILE = join(import.meta.dirname, '..', '..', '.test-backend-port');
const WEBHOOK_URL = '/api/settings/notifications/webhook';

function getBaseUrl(): string {
  if (!existsSync(PORT_FILE)) {
    throw new Error('Contract tests require a running backend via pretest:contract.');
  }
  return `http://127.0.0.1:${readFileSync(PORT_FILE, 'utf8').trim()}`;
}

const TEST_WEBHOOK: { url: string; events: string[] } = {
  url: 'https://hooks.example.com/test-webhook',
  events: ['deploy.success', 'deploy.fail'],
};

describe('notifications webhook contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  afterAll(async () => {
    // Best-effort cleanup — ensure no test artifact leaks into other test runs
    await fetch(`${baseUrl}${WEBHOOK_URL}`, { method: 'DELETE' }).catch(() => null);
  });

  it('GET before configuration returns 404', async () => {
    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`);
    expect(res.status).toBe(404);
  });

  it('POST creates the webhook and returns 200', async () => {
    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_WEBHOOK),
    });
    expect(res.status).toBe(200);
  });

  it('GET after POST returns 200 with parseable NotificationWebhookConfig', async () => {
    // Ensure webhook exists from previous test
    await fetch(`${baseUrl}${WEBHOOK_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_WEBHOOK),
    });

    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = NotificationWebhookConfigSchema.parse(body);

    expect(parsed.url).toBe(TEST_WEBHOOK.url);
    expect(parsed.events).toEqual(expect.arrayContaining(TEST_WEBHOOK.events));
  });

  it('saved URL round-trips exactly (not truncated or mutated)', async () => {
    await fetch(`${baseUrl}${WEBHOOK_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_WEBHOOK),
    });

    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`);
    const body: unknown = await res.json();
    const { url } = NotificationWebhookConfigSchema.parse(body);
    expect(url).toBe(TEST_WEBHOOK.url);
  });

  it('DELETE returns 200', async () => {
    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('GET after DELETE returns 404', async () => {
    // Ensure deleted
    await fetch(`${baseUrl}${WEBHOOK_URL}`, { method: 'DELETE' });

    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`);
    expect(res.status).toBe(404);
  });

  it('invalid webhook body (missing url) is rejected by the server', async () => {
    const res = await fetch(`${baseUrl}${WEBHOOK_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: ['deploy.success'] }), // missing url
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
