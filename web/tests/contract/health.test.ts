/**
 * Contract test: GET /api/services/:id/health
 *
 * Asserts shape of ServiceHealth response against ServiceHealthSchema.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { ServiceHealthSchema, ServiceHealthValueSchema } from '../../src/lib/api/services-zod';

const PORT_FILE = join(import.meta.dirname, '..', '..', '.test-backend-port');

function getBaseUrl(): string {
  if (!existsSync(PORT_FILE)) {
    throw new Error('Contract tests require a running backend via pretest:contract.');
  }
  return `http://127.0.0.1:${readFileSync(PORT_FILE, 'utf8').trim()}`;
}

describe('health contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  it('GET /api/services/svc-web/health returns 200 with parseable health', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-web/health`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = ServiceHealthSchema.parse(body);

    expect(['healthy', 'crashed']).toContain(parsed.health);
  });

  it('seeded svc-web health is "healthy"', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-web/health`);
    const body: unknown = await res.json();
    const { health } = ServiceHealthSchema.parse(body);
    expect(health).toBe('healthy');
  });

  it('invalid health string causes zod parse failure', () => {
    expect(() => ServiceHealthValueSchema.parse('degraded')).toThrow(z.ZodError);
    expect(() => ServiceHealthValueSchema.parse('unknown')).toThrow(z.ZodError);
  });

  it('GET /api/services/nonexistent/health returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/services/nonexistent-svc-id/health`);
    expect(res.status).toBe(404);
  });
});
