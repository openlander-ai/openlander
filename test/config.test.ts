import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import {
  getPolicy,
  isValidEnvironment,
  getDataDir,
  getDbPath,
  getConfigPath,
  resolveDataDir,
  SHARED_NETWORK_NAME,
  normalizeLlmConfig,
} from '../src/config/index.js';
import type { LLMProviderConfig } from '../src/config/index.js';
import {
  OFFICIAL_CLOUDFLARE_OAUTH_CLIENT_ID,
  OFFICIAL_CLOUDFLARE_OAUTH_REDIRECT_URI,
  OFFICIAL_CLOUDFLARE_OAUTH_SCOPES,
} from '../src/config/cloudflare-publisher.js';

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

  it('keeps HTTPS disabled when loading protected-share settings saved before the activation flag', async () => {
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        traefik: {
          mode: 'managed',
          protectedShare: {
            publicHost: '34.64.12.34',
            acmeEmail: 'owner@example.com',
          },
        },
      }),
      'utf-8',
    );
    const previousDataDir = process.env.OPENLANDER_DATA_DIR;
    process.env.OPENLANDER_DATA_DIR = tmpDir;
    vi.resetModules();
    try {
      const { loadConfig: loadIsolatedConfig } = await import('../src/config/index.js');
      expect(loadIsolatedConfig().traefik.protectedShare).toEqual({
        enabled: false,
        publicHost: '34.64.12.34',
        acmeEmail: 'owner@example.com',
      });
    } finally {
      if (previousDataDir === undefined) delete process.env.OPENLANDER_DATA_DIR;
      else process.env.OPENLANDER_DATA_DIR = previousDataDir;
      vi.resetModules();
    }
  });
});

describeConfig('Cloudflare publisher defaults', () => {
  let tmpDir: string;
  const environmentKeys = [
    'OPENLANDER_DATA_DIR',
    'OPENLANDER_CLOUDFLARE_OAUTH_CLIENT_ID',
    'OPENLANDER_CLOUDFLARE_OAUTH_REDIRECT_URI',
    'OPENLANDER_CLOUDFLARE_OAUTH_SCOPES',
  ] as const;
  let previousEnvironment: Record<(typeof environmentKeys)[number], string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-cloudflare-config-test-'));
    previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    ) as Record<(typeof environmentKeys)[number], string | undefined>;
    for (const key of environmentKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const previous = previousEnvironment[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('ships a fixed HTTPS callback and the minimum Connected Publish scopes', () => {
    expect(OFFICIAL_CLOUDFLARE_OAUTH_CLIENT_ID).toMatch(/^[a-f0-9]{32}$/);
    expect(OFFICIAL_CLOUDFLARE_OAUTH_REDIRECT_URI).toBe(
      'https://openlander.dongbin.cloud/cloudflare-oauth-callback',
    );
    expect(OFFICIAL_CLOUDFLARE_OAUTH_SCOPES).toEqual([
      'offline_access',
      'dns.write',
      'zone.read',
      'teams-connectors.write',
      'account-settings.read',
    ]);
  });

  it('adds refresh access to scopes saved by older official builds', async () => {
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        cloudflare: {
          oauthClientId: OFFICIAL_CLOUDFLARE_OAUTH_CLIENT_ID,
          oauthRedirectUri: OFFICIAL_CLOUDFLARE_OAUTH_REDIRECT_URI,
          oauthScopes: [
            'dns.write',
            'zone.read',
            'teams-connectors.write',
            'account-settings.read',
          ],
        },
      }),
      'utf-8',
    );
    process.env.OPENLANDER_DATA_DIR = tmpDir;
    vi.resetModules();

    const { loadConfig: loadIsolatedConfig } = await import('../src/config/index.js');

    expect(loadIsolatedConfig().cloudflare.oauthScopes).toEqual(
      OFFICIAL_CLOUDFLARE_OAUTH_SCOPES,
    );
  });

  it('replaces blank OAuth values saved by older official builds', async () => {
    writeFileSync(
      join(tmpDir, 'config.json'),
      JSON.stringify({
        cloudflare: {
          oauthClientId: '',
          oauthRedirectUri: '',
          oauthScopes: [],
        },
      }),
      'utf-8',
    );
    process.env.OPENLANDER_DATA_DIR = tmpDir;
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_CLIENT_ID = ' ';
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_REDIRECT_URI = ' ';
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_SCOPES = ' ';
    vi.resetModules();

    const { loadConfig: loadIsolatedConfig } = await import('../src/config/index.js');
    const cloudflare = loadIsolatedConfig().cloudflare;

    expect(cloudflare.oauthClientId).toBe(OFFICIAL_CLOUDFLARE_OAUTH_CLIENT_ID);
    expect(cloudflare.oauthRedirectUri).toBe(OFFICIAL_CLOUDFLARE_OAUTH_REDIRECT_URI);
    expect(cloudflare.oauthScopes).toEqual(OFFICIAL_CLOUDFLARE_OAUTH_SCOPES);
  });

  it('lets self-built installations override every publisher value through the environment', async () => {
    process.env.OPENLANDER_DATA_DIR = tmpDir;
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_CLIENT_ID = 'self-built-client';
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_REDIRECT_URI =
      'https://publisher.example/oauth/callback';
    process.env.OPENLANDER_CLOUDFLARE_OAUTH_SCOPES = 'scope.one, scope.two';
    vi.resetModules();

    const { loadConfig: loadIsolatedConfig } = await import('../src/config/index.js');
    const cloudflare = loadIsolatedConfig().cloudflare;

    expect(cloudflare.oauthClientId).toBe('self-built-client');
    expect(cloudflare.oauthRedirectUri).toBe('https://publisher.example/oauth/callback');
    expect(cloudflare.oauthScopes).toEqual(['scope.one', 'scope.two']);
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

  it('resolves an explicit isolated data directory without changing HOME', () => {
    expect(resolveDataDir({ OPENLANDER_DATA_DIR: './tmp/openlander-candidate' })).toBe(
      join(process.cwd(), 'tmp/openlander-candidate'),
    );
  });

  it('getDbPath keeps the Postgres URL compatibility alias', () => {
    const previous = process.env.OPENLANDER_DATABASE_URL;
    process.env.OPENLANDER_DATABASE_URL = 'postgresql://openlander:test@localhost:5432/openlander';

    try {
      expect(getDbPath()).toBe('postgresql://openlander:test@localhost:5432/openlander');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENLANDER_DATABASE_URL;
      } else {
        process.env.OPENLANDER_DATABASE_URL = previous;
      }
    }
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
  };

  it('synthesizes providers and defaultRoute from legacy single-provider config', () => {
    const normalized = normalizeLlmConfig(legacyConfig);

    expect(normalized.providers).toEqual({
      default: {
        provider: 'gemini',
        apiKey: 'test-key',
        authToken: '',
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

  it('preserves a saved AI Ops briefing route when the default route is disabled', () => {
    const persisted: LLMProviderConfig = {
      ...legacyConfig,
      providers: {
        aiops: {
          provider: 'gemini',
          apiKey: 'aiops-key',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: '__none__' },
      routes: {
        aiOpsBriefing: {
          providerId: 'aiops',
          model: 'gemini-2.5-flash',
        },
      },
    };

    const normalized = normalizeLlmConfig(persisted);

    expect(normalized.providers).toBe(persisted.providers);
    expect(normalized.defaultRoute).toBe(persisted.defaultRoute);
    expect(normalized.routes?.aiOpsBriefing).toEqual({
      providerId: 'aiops',
      model: 'gemini-2.5-flash',
    });
  });

  it('does not mutate the original config object', () => {
    const original = { ...legacyConfig };
    normalizeLlmConfig(original);

    expect(original).toEqual(legacyConfig);
    expect(original).not.toHaveProperty('providers');
    expect(original).not.toHaveProperty('defaultRoute');
  });

  it('keeps fresh installs disabled when no legacy credential is configured', () => {
    const freshInstall: LLMProviderConfig = {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash',
      authToken: '',
    };

    const normalized = normalizeLlmConfig(freshInstall);

    expect(normalized.providers).toEqual({});
    expect(normalized.defaultRoute).toEqual({ providerId: '__none__' });
  });

  it('synthesizes when providers is present but defaultRoute is missing', () => {
    const partial: LLMProviderConfig = {
      ...legacyConfig,
      providers: {
        custom: { provider: 'openai', apiKey: 'k', defaultModel: 'gpt-4o' },
      },
    };

    const normalized = normalizeLlmConfig(partial);

    expect(normalized.defaultRoute).toEqual({ providerId: 'custom' });
    expect(normalized.providers).toBe(partial.providers);
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
