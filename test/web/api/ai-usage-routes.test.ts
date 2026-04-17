import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
import { createAiUsageRoutes } from '../../../src/web/api/ai-usage-routes.js';
import type { AppContext } from '../../../src/app.js';

function createTestApp(db: Database) {
  const ctx = { db } as unknown as AppContext;
  const app = new Hono();
  app.route('/api', createAiUsageRoutes(ctx));
  return app;
}

function insertUsageLog(
  db: Database,
  overrides: Partial<{
    project_id: string | null;
    action_type: 'web_agent' | 'auto_recovery' | 'build_debugger' | 'monitor_alert';
    model_name: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: number | null;
    tools_called: string;
    result: 'success' | 'failure' | 'partial';
    duration_ms: number;
  }> = {},
) {
  return db.createAiUsageLog({
    project_id: overrides.project_id ?? null,
    session_id: null,
    action_type: overrides.action_type ?? 'web_agent',
    model_name: overrides.model_name ?? 'gpt-4',
    provider: overrides.provider ?? 'openai',
    input_tokens: overrides.input_tokens ?? 100,
    output_tokens: overrides.output_tokens ?? 50,
    total_tokens: overrides.total_tokens ?? 150,
    cost_usd: overrides.cost_usd ?? 0.01,
    tools_called: overrides.tools_called ?? '[]',
    result: overrides.result ?? 'success',
    error_message: null,
    error_type: null,
    duration_ms: overrides.duration_ms ?? 500,
    user_id: null,
    tenant_id: null,
    source: null,
  });
}

describe('AI Usage Routes', () => {
  let tmpDir: string;
  let db: Database;
  let app: Hono;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-ai-usage-'));
    db = new Database(join(tmpDir, 'test.db'));
    app = createTestApp(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/usage/summary', () => {
    it('returns zeros when DB is empty', async () => {
      const res = await app.request('/api/usage/summary');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: null,
        callCount: 0,
      });
    });

    it('returns aggregate totals', async () => {
      insertUsageLog(db, { input_tokens: 100, output_tokens: 50, cost_usd: 0.01 });
      insertUsageLog(db, { input_tokens: 200, output_tokens: 100, cost_usd: 0.02 });

      const res = await app.request('/api/usage/summary');
      const body = await res.json();

      expect(body.totalInputTokens).toBe(300);
      expect(body.totalOutputTokens).toBe(150);
      expect(body.totalCostUsd).toBeCloseTo(0.03);
      expect(body.callCount).toBe(2);
    });

    it('filters by projectId', async () => {
      insertUsageLog(db, { project_id: 'proj-a', input_tokens: 100 });
      insertUsageLog(db, { project_id: 'proj-b', input_tokens: 200 });

      const res = await app.request('/api/usage/summary?projectId=proj-a');
      const body = await res.json();

      expect(body.totalInputTokens).toBe(100);
      expect(body.callCount).toBe(1);
    });

    it('filters by date range', async () => {
      insertUsageLog(db, { input_tokens: 100 });

      const res = await app.request('/api/usage/summary?from=2020-01-01&to=2099-12-31');
      const body = await res.json();

      expect(body.callCount).toBe(1);
      expect(body.totalInputTokens).toBe(100);
    });

    it('returns zeros for invalid date params', async () => {
      insertUsageLog(db, { input_tokens: 100 });

      const res = await app.request('/api/usage/summary?from=not-a-date');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.callCount).toBe(0);
      expect(body.totalInputTokens).toBe(0);
    });

    it('combines projectId and date range filters', async () => {
      insertUsageLog(db, { project_id: 'proj-a', input_tokens: 100 });
      insertUsageLog(db, { project_id: 'proj-b', input_tokens: 200 });

      const res = await app.request(
        '/api/usage/summary?projectId=proj-a&from=2020-01-01&to=2099-12-31',
      );
      const body = await res.json();

      expect(body.callCount).toBe(1);
      expect(body.totalInputTokens).toBe(100);
    });
  });

  describe('GET /api/usage/recent', () => {
    it('returns empty array when DB is empty', async () => {
      const res = await app.request('/api/usage/recent');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.logs).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('returns logs with default limit of 100', async () => {
      for (let i = 0; i < 3; i++) {
        insertUsageLog(db);
      }

      const res = await app.request('/api/usage/recent');
      const body = await res.json();

      expect(body.logs).toHaveLength(3);
      expect(body.count).toBe(3);
    });

    it('respects limit param', async () => {
      for (let i = 0; i < 5; i++) {
        insertUsageLog(db);
      }

      const res = await app.request('/api/usage/recent?limit=2');
      const body = await res.json();

      expect(body.logs).toHaveLength(2);
      expect(body.count).toBe(5);
    });

    it('clamps limit to max 500', async () => {
      insertUsageLog(db);

      const res = await app.request('/api/usage/recent?limit=9999');
      const body = await res.json();

      expect(body.logs).toHaveLength(1);
      expect(body.count).toBe(1);
    });

    it('clamps limit minimum to 1', async () => {
      insertUsageLog(db);

      const res = await app.request('/api/usage/recent?limit=0');
      const body = await res.json();

      expect(body.logs).toHaveLength(1);
    });

    it('filters by projectId', async () => {
      insertUsageLog(db, { project_id: 'proj-a' });
      insertUsageLog(db, { project_id: 'proj-b' });

      const res = await app.request('/api/usage/recent?projectId=proj-a');
      const body = await res.json();

      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].projectId).toBe('proj-a');
      expect(body.count).toBe(1);
    });

    it('filters by date range', async () => {
      insertUsageLog(db);

      const res = await app.request('/api/usage/recent?from=2020-01-01&to=2099-12-31');
      const body = await res.json();

      expect(body.logs).toHaveLength(1);
    });

    it('returns empty for invalid date params', async () => {
      insertUsageLog(db);

      const res = await app.request('/api/usage/recent?from=bad-date');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.logs).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('handles non-numeric limit gracefully', async () => {
      insertUsageLog(db);

      const res = await app.request('/api/usage/recent?limit=abc');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.logs).toHaveLength(1);
    });
  });
});
