import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import {
  getPolicy,
  isValidEnvironment,
  getDataDir,
  getDbPath,
  getConfigPath,
  SHARED_NETWORK_NAME,
  normalizeLlmConfig,
} from '../src/config/index.js';
import type { LLMProviderConfig } from '../src/config/index.js';

const describeConfig = describe;

describeConfig('Config Deep Merge', () => {
  it('preserves defaults for missing fields', () => {
    const defaults = { a: 1, b: { c: 2, d: 3 } };
    const saved = { a: 10 };

    const merged = deepMerge(defaults, saved);
    expect(merged).toEqual({ a: 10, b: { c: 2, d: 3 } });
  });

  it('deep merges nested objects', () => {
    const defaults = { a: { b: 1, c: 2 }, d: 3 };
    const saved = { a: { b: 99 } } as unknown as Partial<typeof defaults>;

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

describeConfig('Config DB Path', () => {
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

describeConfig('Environment Policies', () => {
  it('returns production policy', () => {
    const policy = getPolicy('production');
    expect(policy.networkName).toBe(SHARED_NETWORK_NAME);
    expect(policy.portRangeStart).toBe(10001);
    expect(policy.portRangeEnd).toBe(10999);
  });

  it('returns development policy with separate port range', () => {
    const policy = getPolicy('development');
    expect(policy.networkName).toBe(SHARED_NETWORK_NAME);
    expect(policy.portRangeStart).toBe(20001);
    expect(policy.portRangeEnd).toBe(20999);
  });

  it('port ranges do not overlap', () => {
    const prod = getPolicy('production');
    const dev = getPolicy('development');
    expect(prod.portRangeEnd).toBeLessThan(dev.portRangeStart);
  });

  it('network names converge to shared network across environments', () => {
    expect(getPolicy('production').networkName).toBe(SHARED_NETWORK_NAME);
    expect(getPolicy('development').networkName).toBe(SHARED_NETWORK_NAME);
  });
});

describeConfig('Environment Validation', () => {
  it('accepts valid environment types', () => {
    expect(isValidEnvironment('production')).toBe(true);
    expect(isValidEnvironment('development')).toBe(true);
  });

  it('rejects invalid environment types', () => {
    expect(isValidEnvironment('staging')).toBe(false);
    expect(isValidEnvironment('../etc/passwd')).toBe(false);
    expect(isValidEnvironment('')).toBe(false);
  });
});

describeConfig('Data Paths', () => {
  it('getDataDir returns ~/.openlander', () => {
    expect(getDataDir()).toBe(join(homedir(), '.openlander'));
  });

  it('getDbPath returns ~/.openlander/openlander.db', () => {
    expect(getDbPath()).toContain('openlander.db');
  });

  it('getConfigPath returns ~/.openlander/config.json', () => {
    expect(getConfigPath()).toContain('config.json');
  });
});

describeConfig('normalizeLlmConfig', () => {
  const legacyConfig: LLMProviderConfig = {
    provider: 'gemini',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    authToken: '',
    ollamaEndpoint: 'http://localhost:11434',
  };

  it('synthesizes providers and defaultRoute from legacy single-provider config', () => {
    const normalized = normalizeLlmConfig(legacyConfig);

    expect(normalized.providers).toEqual({
      default: {
        provider: 'gemini',
        apiKey: 'test-key',
        authToken: '',
        ollamaEndpoint: 'http://localhost:11434',
        defaultModel: 'gemini-2.0-flash',
      },
    });
    expect(normalized.defaultRoute).toEqual({ providerId: 'default' });
  });

  it('preserves original legacy fields alongside synthesized providers', () => {
    const normalized = normalizeLlmConfig(legacyConfig);

    expect(normalized.provider).toBe('gemini');
    expect(normalized.apiKey).toBe('test-key');
    expect(normalized.model).toBe('gemini-2.0-flash');
  });

  it('passes through config that already has providers and defaultRoute', () => {
    const newFormatConfig: LLMProviderConfig = {
      ...legacyConfig,
      providers: {
        fast: {
          provider: 'gemini',
          apiKey: 'fast-key',
          defaultModel: 'gemini-2.0-flash',
        },
        smart: {
          provider: 'anthropic',
          apiKey: 'smart-key',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      },
      defaultRoute: { providerId: 'fast' },
      routes: { buildDebugger: { providerId: 'smart' } },
    };

    const normalized = normalizeLlmConfig(newFormatConfig);

    expect(normalized.providers).toBe(newFormatConfig.providers);
    expect(normalized.defaultRoute).toBe(newFormatConfig.defaultRoute);
    expect(normalized.routes).toEqual({ buildDebugger: { providerId: 'smart' } });
  });

  it('does not mutate the original config object', () => {
    const original = { ...legacyConfig };
    normalizeLlmConfig(original);

    expect(original).toEqual(legacyConfig);
    expect(original).not.toHaveProperty('providers');
    expect(original).not.toHaveProperty('defaultRoute');
  });

  it('synthesizes when providers is present but defaultRoute is missing', () => {
    const partial: LLMProviderConfig = {
      ...legacyConfig,
      providers: {
        custom: { provider: 'openai', apiKey: 'k', defaultModel: 'gpt-4o' },
      },
    };

    const normalized = normalizeLlmConfig(partial);

    expect(normalized.defaultRoute).toEqual({ providerId: 'default' });
    expect(normalized.providers.default).toBeDefined();
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
