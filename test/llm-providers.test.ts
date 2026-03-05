import { describe, it, expect } from 'vitest';

import { createModel, type LLMConfig } from '../src/llm/index.js';
import { LLMNotConfiguredError } from '../src/errors.js';

// ---------------------------------------------------------------------------
// createModel factory tests
//
// Since createModel returns AI SDK LanguageModel objects from provider packages,
// we test the factory logic (routing, error handling) without mocking fetch.
// The returned LanguageModel objects are opaque — we verify they exist and
// that the factory throws correctly for invalid configs.
// ---------------------------------------------------------------------------

describe('createModel', () => {
  it('returns a LanguageModel for gemini provider', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'test-key' };
    const model = createModel(config);
    expect(model).toBeDefined();
    expect(model.modelId).toContain('gemini');
  });

  it('returns a LanguageModel for anthropic provider', () => {
    const config: LLMConfig = { provider: 'anthropic', apiKey: 'test-key' };
    const model = createModel(config);
    expect(model).toBeDefined();
    expect(model.modelId).toContain('claude');
  });

  it('returns a LanguageModel for openai provider', () => {
    const config: LLMConfig = { provider: 'openai', apiKey: 'test-key' };
    const model = createModel(config);
    expect(model).toBeDefined();
    expect(model.modelId).toContain('gpt');
  });

  it('returns a LanguageModel for openrouter provider', () => {
    const config: LLMConfig = { provider: 'openrouter', apiKey: 'test-key' };
    const model = createModel(config);
    expect(model).toBeDefined();
  });

  it('returns a LanguageModel for ollama provider without apiKey', () => {
    const config: LLMConfig = { provider: 'ollama', apiKey: '' };
    const model = createModel(config);
    expect(model).toBeDefined();
  });

  it('throws LLMNotConfiguredError when apiKey is missing (non-ollama)', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: '' };
    expect(() => createModel(config)).toThrow(LLMNotConfiguredError);
  });

  it('uses authToken over apiKey when both are provided', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'api-key', authToken: 'auth-token' };
    const model = createModel(config);
    expect(model).toBeDefined();
  });

  it('throws for unknown provider type', () => {
    const config = { provider: 'unknown' as 'gemini', apiKey: 'test-key' };
    expect(() => createModel(config)).toThrow('Unknown LLM provider');
  });

  it('uses custom model when provided', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-1.5-pro' };
    const model = createModel(config);
    expect(model).toBeDefined();
    expect(model.modelId).toContain('gemini-1.5-pro');
  });

  it('ollama uses custom baseUrl when provided', () => {
    const config: LLMConfig = {
      provider: 'ollama',
      apiKey: '',
      ollamaBaseUrl: 'http://custom:11434',
    };
    const model = createModel(config);
    expect(model).toBeDefined();
  });
});
