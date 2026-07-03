import { describe, expect, it } from 'vitest';
import { resolveAiOpsBriefingHealth } from '../../src/web/server.js';
import type { LLMProviderConfig } from '../../src/config/index.js';

const baseLlmConfig: LLMProviderConfig = {
  provider: 'gemini',
  apiKey: '',
  authToken: '',
  model: 'gemini-2.5-flash',
};

describe('resolveAiOpsBriefingHealth', () => {
  it('reports a saved AI Ops route with encrypted credentials as configured', () => {
    const result = resolveAiOpsBriefingHealth({
      ...baseLlmConfig,
      providers: {
        aiops: {
          provider: 'gemini',
          encryptedApiKey: 'ciphertext',
          apiKeyIv: 'iv',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: '__none__' },
      routes: { aiOpsBriefing: { providerId: 'aiops', model: 'gemini-2.5-flash' } },
    });

    expect(result).toEqual({
      configured: true,
      status: 'configured',
      routeSource: 'feature',
    });
  });

  it('reports the feature route as missing when it points at an absent provider', () => {
    const result = resolveAiOpsBriefingHealth({
      ...baseLlmConfig,
      providers: {},
      defaultRoute: { providerId: '__none__' },
      routes: { aiOpsBriefing: { providerId: 'aiops' } },
    });

    expect(result).toEqual({
      configured: false,
      status: 'provider_missing',
      routeSource: 'feature',
    });
  });

  it('reports an existing provider without credentials as not usable', () => {
    const result = resolveAiOpsBriefingHealth({
      ...baseLlmConfig,
      providers: {
        aiops: {
          provider: 'gemini',
          apiKey: '',
          authToken: '',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: '__none__' },
      routes: { aiOpsBriefing: { providerId: 'aiops' } },
    });

    expect(result).toEqual({
      configured: false,
      status: 'credential_missing',
      routeSource: 'feature',
    });
  });

  it('reports no route as not configured', () => {
    const result = resolveAiOpsBriefingHealth({
      ...baseLlmConfig,
      providers: {},
      defaultRoute: { providerId: '__none__' },
    });

    expect(result).toEqual({
      configured: false,
      status: 'not_configured',
      routeSource: 'none',
    });
  });

  it('falls back to a configured default route when no feature route is set', () => {
    const result = resolveAiOpsBriefingHealth({
      ...baseLlmConfig,
      providers: {
        default: {
          provider: 'gemini',
          apiKey: 'plain-key',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: 'default' },
    });

    expect(result).toEqual({
      configured: true,
      status: 'configured',
      routeSource: 'default',
    });
  });
});
