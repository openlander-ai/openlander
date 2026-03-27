import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from '../../src/db/index.js';
import { calculateCost, extractUsageFromResult, logAiUsage } from '../../src/llm/transparency.js';

describe('transparency', () => {
  describe('calculateCost', () => {
    it('calculates known model pricing', () => {
      const cost = calculateCost('anthropic', 'claude-sonnet-4-6', 1000, 500);
      expect(cost).toBeCloseTo(0.0105, 10);
    });

    it('returns zero for ollama provider', () => {
      const cost = calculateCost('ollama', 'llama3', 1000, 500);
      expect(cost).toBe(0);
    });

    it('returns null for unknown pricing', () => {
      const cost = calculateCost('unknown-provider', 'unknown-model', 1000, 500);
      expect(cost).toBeNull();
    });
  });

  describe('extractUsageFromResult', () => {
    it('normalizes prompt/completion token fields', () => {
      expect(
        extractUsageFromResult({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        }),
      ).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    });

    it('returns zero usage for empty object', () => {
      expect(extractUsageFromResult({})).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('logAiUsage', () => {
    let tmpDir: string;
    let db: Database;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'openlander-transparency-test-'));
      db = new Database(join(tmpDir, 'test.db'));
    });

    afterEach(() => {
      db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates ai_usage_log record and returns id', async () => {
      const id = await logAiUsage(db, {
        actionType: 'web_agent',
        modelName: 'claude-sonnet-4-6',
        provider: 'anthropic',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        toolsCalled: ['list_projects', 'deploy'],
        result: 'success',
        durationMs: 321,
        source: 'web',
      });

      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const logs = db.getAiUsageLogsByDateRange(new Date('2000-01-01'), new Date('2100-01-01'));
      const created = logs.find((row) => row.id === id);

      expect(created).toBeDefined();
      expect(created?.action_type).toBe('web_agent');
      expect(created?.model_name).toBe('claude-sonnet-4-6');
      expect(created?.provider).toBe('anthropic');
      expect(created?.input_tokens).toBe(100);
      expect(created?.output_tokens).toBe(50);
      expect(created?.total_tokens).toBe(150);
      expect(created?.tools_called).toBe('["list_projects","deploy"]');
      expect(created?.result).toBe('success');
      expect(created?.duration_ms).toBe(321);
      expect(created?.source).toBe('web');
    });
  });
});
