/**
 * Contract test: GET /api/services/:id/metrics
 *
 * Asserts both the 200 path (svc-web has seeded metrics history) and
 * the 204 No Content path (svc-db has no metrics history).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ServiceMetricsSchema } from '../../src/lib/api/services-zod';

const PORT_FILE = join(import.meta.dirname, '..', '..', '.test-backend-port');

function getBaseUrl(): string {
  if (!existsSync(PORT_FILE)) {
    throw new Error('Contract tests require a running backend via pretest:contract.');
  }
  return `http://127.0.0.1:${readFileSync(PORT_FILE, 'utf8').trim()}`;
}

describe('metrics contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  // ── 200 path: svc-web has seeded metrics ───────────────────────────────────

  it('GET /api/services/svc-web/metrics returns 200 with parseable ServiceMetrics', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-web/metrics?range=1h`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = ServiceMetricsSchema.parse(body);

    // All four time-series arrays should be 60 datapoints
    expect(parsed.cpu.length).toBe(60);
    expect(parsed.memory.length).toBe(60);
    expect(parsed.requestsPerSec.length).toBe(60);
    expect(parsed.errorRate.length).toBe(60);

    // Scalar aggregates are numbers
    expect(typeof parsed.p95LatencyMs).toBe('number');
    expect(typeof parsed.totalRequests).toBe('number');
  });

  it('all cpu values are numbers in [0, 100]', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-web/metrics?range=1h`);
    const body: unknown = await res.json();
    const { cpu } = ServiceMetricsSchema.parse(body);
    for (const v of cpu) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  // ── 204 path: svc-db has NO seeded metrics ─────────────────────────────────

  it('GET /api/services/svc-db/metrics returns 204 when no history', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-db/metrics?range=1h`);
    // Backend must return 204 No Content (not 200 with empty arrays)
    expect(res.status).toBe(204);
  });

  it('204 response has no body to parse', async () => {
    const res = await fetch(`${baseUrl}/api/services/svc-db/metrics?range=1h`);
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  // ── Range param is forwarded ───────────────────────────────────────────────

  it('different range params return 200 for svc-web', async () => {
    for (const range of ['15m', '1h', '6h', '24h', '7d']) {
      const res = await fetch(`${baseUrl}/api/services/svc-web/metrics?range=${range}`);
      expect(res.status).toBe(200);
    }
  });
});
