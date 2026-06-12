import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decrypt, _resetCachedKey } from '../../src/env/crypto.js';
import { OpenLanderError } from '../../src/errors.js';
import { buildEncryptedAiOpsProviderEntry } from '../../src/llm/provider-config.js';

const TEST_MASTER_KEY = '0'.repeat(64);

describe('AI Ops provider config helpers', () => {
  const previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];

  beforeEach(() => {
    process.env['OPENLANDER_MASTER_KEY'] = TEST_MASTER_KEY;
    _resetCachedKey();
  });

  afterEach(() => {
    if (previousMasterKey === undefined) {
      delete process.env['OPENLANDER_MASTER_KEY'];
    } else {
      process.env['OPENLANDER_MASTER_KEY'] = previousMasterKey;
    }
    _resetCachedKey();
  });

  it('stores OpenAI-compatible provider keys encrypted and preserves baseURL', () => {
    const entry = buildEncryptedAiOpsProviderEntry({
      provider: 'openai',
      apiKey: ' sk-test ',
      defaultModel: ' gpt-4.1-mini ',
      baseURL: ' https://openrouter.ai/api/v1 ',
    });

    expect(entry.provider).toBe('openai');
    expect(entry.defaultModel).toBe('gpt-4.1-mini');
    expect(entry.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(entry.apiKey).toBeUndefined();
    expect(entry.encryptedApiKey).toBeTypeOf('string');
    expect(entry.apiKeyIv).toBeTypeOf('string');
    expect(decrypt(entry.encryptedApiKey!, entry.apiKeyIv!)).toBe('sk-test');
  });

  it('does not persist Anthropic baseURL overrides', () => {
    const entry = buildEncryptedAiOpsProviderEntry({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-6',
      baseURL: 'https://example.invalid',
    });

    expect(entry.provider).toBe('anthropic');
    expect(entry.baseURL).toBeUndefined();
    expect(decrypt(entry.encryptedApiKey!, entry.apiKeyIv!)).toBe('sk-ant-test');
  });

  it('stores Gemini provider keys encrypted without baseURL overrides', () => {
    const entry = buildEncryptedAiOpsProviderEntry({
      provider: 'gemini',
      apiKey: 'google-ai-key',
      defaultModel: 'gemini-2.5-flash',
      baseURL: 'https://example.invalid',
    });

    expect(entry.provider).toBe('gemini');
    expect(entry.defaultModel).toBe('gemini-2.5-flash');
    expect(entry.baseURL).toBeUndefined();
    expect(entry.apiKey).toBeUndefined();
    expect(decrypt(entry.encryptedApiKey!, entry.apiKeyIv!)).toBe('google-ai-key');
  });

  it('rejects empty provider secrets without enabling AI Ops', () => {
    expect(() =>
      buildEncryptedAiOpsProviderEntry({
        provider: 'openai',
        apiKey: '   ',
        defaultModel: 'gpt-4o',
      }),
    ).toThrow(OpenLanderError);
  });
});
