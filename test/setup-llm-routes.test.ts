import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateText } from 'ai';

import type { AppContext } from '../src/app.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import { Database } from '../src/db/index.js';
import { createSetupRoutes } from '../src/web/api/setup-routes.js';
import { createMockContext } from './helpers/web-route-mocks.js';
import * as configModule from '../src/config/index.js';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

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

function createBaseConfig(): OpenLanderConfig {
  return {
    language: 'en',
    llm: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.0-flash',
      authToken: '',
      ollamaEndpoint: 'http://localhost:11434',
      providers: {
        primary: {
          provider: 'gemini',
          apiKey: 'test-gemini-key',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: 'primary' },
      routes: {},
    },
    server: {
      port: 10114,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:10114',
    },
    docker: {
      socketPath: '',
      networkName: 'openlander',
      portRangeStart: 10001,
      portRangeEnd: 10999,
    },
    git: {
      sshKeyPath: '',
      cloneDir: '/tmp/openlander-test-repos',
    },
    cloudflare: {
      apiToken: '',
      tunnelId: '',
      accountId: '',
    },
    monitoring: {
      healthcheckIntervalSec: 60,
      inactivityThresholdDays: 14,
    },
    mcp: {
      enabled: false,
      transport: 'stdio',
      servers: [],
      platformTools: false,
    },
    channels: {
      slack: { enabled: false, token: '', signingSecret: '', recoveryChannelId: '' },
      discord: {
        enabled: false,
        token: '',
        applicationId: '',
        publicKey: '',
        recoveryChannelId: '',
      },
      telegram: { enabled: false, token: '', webhookSecret: '', recoveryChannelId: '' },
    },
    gitProviders: {
      github: { token: '', username: '' },
      gitlab: { token: '', username: '' },
    },
    localModel: {
      preferLocal: false,
      modelName: 'openlander-agent',
    },
    traefik: {
      mode: 'managed',
      externalNetwork: undefined,
    },
    ai: {
      autoRecovery: { enabled: true },
      buildDebugger: { enabled: true },
      webAgent: { enabled: true },
      envDetection: { enabled: true },
      secretScan: { enabled: true },
      rollbackSuggestion: { enabled: true },
      operationalMonitoring: { enabled: true },
    },
  };
}

describe('Setup LLM routes', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;
  let ctx: AppContext;
  let configState: OpenLanderConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    configState = createBaseConfig();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-setup-llm-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    ctx = createMockContext(db);
    ctx.config = configState;

    (
      ctx.docker as unknown as {
        status: ReturnType<typeof vi.fn>;
      }
    ).status = vi.fn().mockResolvedValue({ state: 'running' });
    (
      ctx.traefik as unknown as {
        isRunning: ReturnType<typeof vi.fn>;
      }
    ).isRunning = vi.fn().mockResolvedValue(true);

    vi.spyOn(configModule, 'loadConfig').mockImplementation(() => configState);
    vi.spyOn(configModule, 'updateConfig').mockImplementation((partial) => {
      configState = deepMerge(
        configState as unknown as Record<string, unknown>,
        partial,
      ) as OpenLanderConfig;
      return configState;
    });
    vi.spyOn(configModule, 'saveConfig').mockImplementation((config) => {
      configState = config;
    });

    vi.mocked(generateText).mockResolvedValue({
      text: 'ok',
    } as never);

    app = new Hono();
    app.route('/api', createSetupRoutes(ctx));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tests a stored provider by provider_id and updates verification for default provider', async () => {
    const res = await app.request('/api/setup/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'primary' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.providerId).toBe('primary');
    expect(body.provider).toBe('gemini');
    expect(body.model).toBe('gemini-2.5-flash');
    expect(ctx.llmVerified).toBe(true);
  });

  it('returns 404 when provider_id is unknown', async () => {
    const res = await app.request('/api/setup/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: 'missing-provider' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Provider not found');
  });

  it('does not overwrite global verification on dry-run test with explicit credentials', async () => {
    ctx.llmVerified = true;
    vi.mocked(generateText).mockRejectedValueOnce(new Error('dry-run failure'));

    const res = await app.request('/api/setup/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        api_key: 'temporary-key',
        model: 'gemini-2.5-flash',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('dry-run failure');
    expect(ctx.llmVerified).toBe(true);
  });

  it('setup status uses provider-registry default provider and treats configured as llm.ok', async () => {
    ctx.llmVerified = false;

    const res = await app.request('/api/setup/status');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.llm.ok).toBe(true);
    expect(body.llm.provider).toBe('gemini');
    expect(body.llm.model).toBe('gemini-2.5-flash');
    expect(body.llm.message).toContain('latest connection test failed');
  });

  it('keeps verification when adding a non-default provider', async () => {
    ctx.llmVerified = true;

    const res = await app.request('/api/setup/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'secondary',
        provider: 'openai',
        apiKey: 'test-openai-key',
        defaultModel: 'gpt-4.1-mini',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('added');
    expect(ctx.llmVerified).toBe(true);
  });
});
