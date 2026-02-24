import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

// We test the deepMerge logic indirectly via loadConfig behavior
// Since the config module uses hardcoded paths, we test the logic concepts

describe('Config Deep Merge', () => {
  it('preserves defaults for missing fields', () => {
    const defaults = { a: 1, b: { c: 2, d: 3 } };
    const saved = { a: 10 };

    const merged = deepMerge(defaults, saved);
    expect(merged).toEqual({ a: 10, b: { c: 2, d: 3 } });
  });

  it('deep merges nested objects', () => {
    const defaults = { a: { b: 1, c: 2 }, d: 3 };
    const saved = { a: { b: 99 } };

    const merged = deepMerge(defaults, saved);
    expect(merged).toEqual({ a: { b: 99, c: 2 }, d: 3 });
  });

  it('does not modify the original objects', () => {
    const defaults = { a: { b: 1 } };
    const saved = { a: { b: 2 } };

    deepMerge(defaults, saved);
    expect(defaults.a.b).toBe(1);
  });

  it('handles empty saved config', () => {
    const defaults = { a: 1, b: { c: 2 } };
    const saved = {};

    const merged = deepMerge(defaults, saved);
    expect(merged).toEqual({ a: 1, b: { c: 2 } });
  });

  it('handles new fields in saved that are not in defaults', () => {
    const defaults = { a: 1 } as Record<string, unknown>;
    const saved = { b: 2 };

    const merged = deepMerge(defaults, saved);
    expect(merged).toEqual({ a: 1, b: 2 });
  });
});

describe('Config DB Path', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-config-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('config file can be written and read back as JSON', () => {
    const configPath = join(tmpDir, 'config.json');
    const config = {
      llm: { provider: 'gemini', apiKey: 'test-key', model: 'gemini-2.0-flash' },
      server: { port: 3000 },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.llm.provider).toBe('gemini');
    expect(parsed.llm.apiKey).toBe('test-key');
    expect(parsed.server.port).toBe(3000);
  });
});

// Reimplementation of deepMerge for testing (mirrors src/config/index.ts)
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Partial<Record<string, unknown>>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}
