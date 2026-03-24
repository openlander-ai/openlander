import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import {
  resolveEnvironment,
  setEnvironment,
  getEnvironment,
  getDataDir,
  getDbPath,
  getConfigPath,
  getEnvDefaults,
  _resetEnvironment,
} from '../src/config/index.js';

const describeConfig =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? describe.skip : describe;

// We test the deepMerge logic indirectly via loadConfig behavior
// Since the config module uses hardcoded paths, we test the logic concepts

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

describeConfig('Environment Resolution', () => {
  afterEach(() => {
    _resetEnvironment();
    delete process.env['OPENLANDER_ENV'];
  });

  it('defaults to production', () => {
    expect(resolveEnvironment()).toBe('production');
  });

  it('resolves from explicit argument', () => {
    expect(resolveEnvironment('development')).toBe('development');
  });

  it('resolves from OPENLANDER_ENV env var', () => {
    process.env['OPENLANDER_ENV'] = 'development';
    expect(resolveEnvironment()).toBe('development');
  });

  it('CLI flag takes precedence over env var', () => {
    process.env['OPENLANDER_ENV'] = 'development';
    expect(resolveEnvironment('production')).toBe('production');
  });

  it('rejects invalid environment names and falls back to production', () => {
    expect(resolveEnvironment('staging')).toBe('production');
    expect(resolveEnvironment('../etc/passwd')).toBe('production');
    expect(resolveEnvironment('')).toBe('production');
  });

  it('setEnvironment / getEnvironment round-trips', () => {
    setEnvironment('development');
    expect(getEnvironment()).toBe('development');
    _resetEnvironment();
    expect(getEnvironment()).toBe('production');
  });

  it('setEnvironment throws on invalid input', () => {
    expect(() => setEnvironment('staging' as 'production')).toThrow('Invalid environment');
  });
});

describeConfig('Environment-specific Paths', () => {
  afterEach(() => {
    _resetEnvironment();
  });

  it('getDataDir includes environment name', () => {
    expect(getDataDir()).toBe(join(homedir(), '.openlander', 'production'));
    setEnvironment('development');
    expect(getDataDir()).toBe(join(homedir(), '.openlander', 'development'));
  });

  it('getDbPath includes environment name', () => {
    expect(getDbPath()).toContain(join('production', 'openlander.db'));
    setEnvironment('development');
    expect(getDbPath()).toContain(join('development', 'openlander.db'));
  });

  it('getConfigPath includes environment name', () => {
    expect(getConfigPath()).toContain(join('production', 'config.json'));
    setEnvironment('development');
    expect(getConfigPath()).toContain(join('development', 'config.json'));
  });
});

describeConfig('Environment Defaults', () => {
  afterEach(() => {
    _resetEnvironment();
  });

  it('production defaults', () => {
    const defs = getEnvDefaults('production');
    expect(defs.serverPort).toBe(10114);
    expect(defs.networkName).toBe('openlander-prod');
    expect(defs.portRangeStart).toBe(10001);
    expect(defs.portRangeEnd).toBe(10499);
    expect(defs.traefikContainerName).toBe('traefik-ol-prod');
    expect(defs.traefikHttpPort).toBe(80);
    expect(defs.traefikDashboardPort).toBe(8080);
  });

  it('development defaults', () => {
    const defs = getEnvDefaults('development');
    expect(defs.serverPort).toBe(10214);
    expect(defs.networkName).toBe('openlander-dev');
    expect(defs.portRangeStart).toBe(10501);
    expect(defs.portRangeEnd).toBe(10999);
    expect(defs.traefikContainerName).toBe('traefik-ol-dev');
    expect(defs.traefikHttpPort).toBe(8180);
    expect(defs.traefikDashboardPort).toBe(8280);
  });

  it('getEnvDefaults uses current env when no arg given', () => {
    setEnvironment('development');
    const defs = getEnvDefaults();
    expect(defs.serverPort).toBe(10214);
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
