/**
 * Contract test: GET /api/services/:id/health
 *
 * Asserts shape of ServiceHealth response against ServiceHealthSchema.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { ServiceHealthSchema, ServiceHealthValueSchema } from '../../src/lib/api/services-zod';
import { getBaseUrl, authedFetch } from './helpers';

describe('health contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  it('GET /api/services/svc-web/health returns 200 or 404 — shape valid when 200', async () => {
    // 200: container is running (Docker available) → shape must parse.
    // 404: container not running (no Docker in test env) → accepted.
    const res = await authedFetch(`${baseUrl}/api/services/svc-web/health`);
    expect([200, 404]).toContain(res.status);

    if (res.status === 200) {
      const body: unknown = await res.json();
      const parsed = ServiceHealthSchema.parse(body);
      expect(['healthy', 'crashed']).toContain(parsed.health);
    }
  });

  it('health value when returned is a valid 2-state enum ("healthy" | "crashed")', async () => {
    // Only validates the schema contract when Docker is available.
    // 404 (no container) is a valid no-Docker response — skip shape check.
    const res = await authedFetch(`${baseUrl}/api/services/svc-web/health`);
    if (res.status === 200) {
      const body: unknown = await res.json();
      const { health } = ServiceHealthSchema.parse(body);
      expect(['healthy', 'crashed']).toContain(health);
    } else {
      expect(res.status).toBe(404);
    }
  });

  it('invalid health string causes zod parse failure', () => {
    expect(() => ServiceHealthValueSchema.parse('degraded')).toThrow(z.ZodError);
    expect(() => ServiceHealthValueSchema.parse('unknown')).toThrow(z.ZodError);
  });

  it('GET /api/services/nonexistent/health returns 404', async () => {
    const res = await authedFetch(`${baseUrl}/api/services/nonexistent-svc-id/health`);
    expect(res.status).toBe(404);
  });
});
