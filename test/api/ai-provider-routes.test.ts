import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { loadConfig, saveConfig } from '../../src/config/index.js';
import { decrypt, _resetCachedKey } from '../../src/env/crypto.js';
import { buildEncryptedAiOpsProviderEntry } from '../../src/llm/provider-config.js';
import { testLlmProviderEntry } from '../../src/llm/provider-health-monitor.js';
import { createAiProviderRoutes } from '../../src/web/api/ai-provider-routes.js';

vi.mock('../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
  };
});

vi.mock('../../src/llm/provider-health-monitor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/provider-health-monitor.js')>();
  return {
    ...actual,
    testLlmProviderEntry: vi.fn(),
  };
});

const TEST_MASTER_KEY = '1'.repeat(64);

function makeConfig(overrides: Partial<OpenLanderConfig['llm']> = {}): OpenLanderConfig {
  return {
    llm: {
      provider: 'gemini',
      apiKey: '',
      authToken: '',
      model: 'gemini-2.5-flash',
      providers: {},
      defaultRoute: { providerId: '__none__' },
      ...overrides,
    },
  } as OpenLanderConfig;
}

function createApp(
  ctx: Partial<AppContext>,
  options: { authKind?: 'session' | 'api_token' | null } = {},
) {
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    if (options.authKind !== null) {
      c.set('authKind', options.authKind ?? 'session');
    }
    await next();
  });
  app.route('/api', createAiProviderRoutes(ctx as AppContext));
  return app;
}

describe('AI provider settings routes', () => {
  const previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];

  beforeEach(() => {
    process.env['OPENLANDER_MASTER_KEY'] = TEST_MASTER_KEY;
    _resetCachedKey();
    vi.mocked(saveConfig).mockReset();
    vi.mocked(testLlmProviderEntry).mockReset();
  });

  afterEach(() => {
    if (previousMasterKey === undefined) {
      delete process.env['OPENLANDER_MASTER_KEY'];
    } else {
      process.env['OPENLANDER_MASTER_KEY'] = previousMasterKey;
    }
    _resetCachedKey();
  });

  it('reports provider configuration separately from AI Ops opt-in', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockReturnValue(config);
    const app = createApp({ config, modelRegistry: { updateConfig: vi.fn() } });

    const res = await app.request('/api/settings/ai-providers');

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toMatchObject({
      configured: false,
      provider_id: 'aiops',
      provider: null,
      ai_ops_enabled_by_provider: false,
    });
  });

  it('requires an authenticated web session for instance-level provider settings', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockReturnValue(config);
    const app = createApp({ config, modelRegistry: { updateConfig: vi.fn() } }, { authKind: null });

    const res = await app.request('/api/settings/ai-providers');

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: 'WEB_SESSION_REQUIRED',
    });
  });

  it('saves encrypted OpenAI-compatible provider config without enabling AI Ops', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockReturnValue(config);
    const updateConfig = vi.fn();
    const app = createApp({ config, modelRegistry: { updateConfig } });

    const res = await app.request('/api/settings/ai-providers/ai-ops-briefing', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        api_key: ' sk-test-aiops ',
        model: ' gpt-4.1-mini ',
        base_url: ' https://openrouter.ai/api/v1 ',
      }),
    });

    expect(res.status).toBe(200);
    const saved = vi.mocked(saveConfig).mock.calls[0]?.[0] as OpenLanderConfig;
    const entry = saved.llm.providers?.['aiops'];
    expect(entry?.provider).toBe('openai');
    expect(entry?.defaultModel).toBe('gpt-4.1-mini');
    expect(entry?.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(entry?.apiKey).toBeUndefined();
    expect(decrypt(entry!.encryptedApiKey!, entry!.apiKeyIv!)).toBe('sk-test-aiops');
    expect(saved.llm.routes?.aiOpsBriefing).toEqual({
      providerId: 'aiops',
      model: 'gpt-4.1-mini',
    });
    expect(saved.llm.provider).toBe('gemini');
    expect(saved.llm.model).toBe('gemini-2.5-flash');
    expect(updateConfig).toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'saved',
      ai_ops_enabled_by_provider: false,
    });
  });

  it('saves encrypted Gemini provider config without enabling AI Ops or baseURL', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockReturnValue(config);
    const updateConfig = vi.fn();
    const app = createApp({ config, modelRegistry: { updateConfig } });

    const res = await app.request('/api/settings/ai-providers/ai-ops-briefing', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        api_key: ' google-ai-key ',
        model: ' gemini-2.5-flash ',
        base_url: ' https://example.invalid ',
      }),
    });

    expect(res.status).toBe(200);
    const saved = vi.mocked(saveConfig).mock.calls[0]?.[0] as OpenLanderConfig;
    const entry = saved.llm.providers?.['aiops'];
    expect(entry?.provider).toBe('gemini');
    expect(entry?.defaultModel).toBe('gemini-2.5-flash');
    expect(entry?.baseURL).toBeUndefined();
    expect(decrypt(entry!.encryptedApiKey!, entry!.apiKeyIv!)).toBe('google-ai-key');
    expect(saved.llm.routes?.aiOpsBriefing).toEqual({
      providerId: 'aiops',
      model: 'gemini-2.5-flash',
    });
    expect(saved.llm.provider).toBe('gemini');
    expect(saved.llm.model).toBe('gemini-2.5-flash');
    expect(updateConfig).toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'saved',
      provider: {
        provider: 'gemini',
        provider_label: 'Gemini API',
        base_url: null,
      },
      ai_ops_enabled_by_provider: false,
    });
  });

  it('blocks unsafe OpenAI-compatible base URLs before testing or saving', async () => {
    const config = makeConfig();
    vi.mocked(loadConfig).mockReturnValue(config);
    const app = createApp({ config, modelRegistry: { updateConfig: vi.fn() } });

    const res = await app.request('/api/settings/ai-providers/ai-ops-briefing/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        api_key: 'sk-test-aiops',
        model: 'gpt-4.1-mini',
        base_url: 'http://169.254.169.254/latest/meta-data',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
    });
    expect(testLlmProviderEntry).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('tests a provider without writing config and redacts provider errors', async () => {
    const encrypted = buildEncryptedAiOpsProviderEntry({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    const config = makeConfig({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      providers: { aiops: encrypted },
      defaultRoute: { providerId: 'aiops' },
      routes: { aiOpsBriefing: { providerId: 'aiops', model: 'claude-sonnet-4-20250514' } },
    });
    vi.mocked(loadConfig).mockReturnValue(config);
    vi.mocked(testLlmProviderEntry).mockResolvedValue({
      ok: false,
      latencyMs: 12,
      checkedAt: new Date('2026-06-12T00:00:00.000Z'),
      error: 'provider failed api_key=abcdefghijklmnopqrstuvwxyz123456',
    });
    const app = createApp({ config, modelRegistry: { updateConfig: vi.fn() } });

    const res = await app.request('/api/settings/ai-providers/ai-ops-briefing/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      }),
    });

    expect(res.status).toBe(200);
    expect(saveConfig).not.toHaveBeenCalled();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('failed');
    expect(JSON.stringify(body)).toContain('api_key=***');
    expect(JSON.stringify(body)).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
  });
});
