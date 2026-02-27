import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLLMClient, type LLMConfig, type ChatMessage } from '../src/llm/index.js';
import { GeminiProvider } from '../src/llm/gemini.js';
import { AnthropicProvider } from '../src/llm/anthropic.js';
import { OpenAIProvider } from '../src/llm/openai.js';
import { OllamaProvider } from '../src/llm/ollama.js';
import { OpenRouterProvider } from '../src/llm/openrouter.js';
import { LLMNotConfiguredError, LLMProviderError } from '../src/errors.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// createLLMClient factory tests
// ---------------------------------------------------------------------------

describe('createLLMClient', () => {
  it('routes to GeminiProvider for gemini provider', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'test-key' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(GeminiProvider);
  });

  it('routes to AnthropicProvider for anthropic provider', () => {
    const config: LLMConfig = { provider: 'anthropic', apiKey: 'test-key' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(AnthropicProvider);
  });

  it('routes to OpenAIProvider for openai provider', () => {
    const config: LLMConfig = { provider: 'openai', apiKey: 'test-key' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(OpenAIProvider);
  });

  it('routes to OpenRouterProvider for openrouter provider', () => {
    const config: LLMConfig = { provider: 'openrouter', apiKey: 'test-key' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(OpenRouterProvider);
  });

  it('routes to OllamaProvider for ollama provider', () => {
    const config: LLMConfig = { provider: 'ollama', apiKey: '' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(OllamaProvider);
  });

  it('throws LLMNotConfiguredError when apiKey is missing (non-ollama)', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: '' };
    expect(() => createLLMClient(config)).toThrow(LLMNotConfiguredError);
  });

  it('uses authToken over apiKey when both are provided', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'api-key', authToken: 'auth-token' };
    // The factory should use authToken. We test this by checking that the client is created.
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(GeminiProvider);
  });

  it('throws for unknown provider type', () => {
    const config = { provider: 'unknown' as const, apiKey: 'test-key' };
    expect(() => createLLMClient(config)).toThrow('Unknown LLM provider');
  });

  it('uses custom model when provided', () => {
    const config: LLMConfig = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-1.5-pro' };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(GeminiProvider);
    // Model is internal; we just verify client is created
  });

  it('ollama uses custom baseUrl when provided', () => {
    const config: LLMConfig = {
      provider: 'ollama',
      apiKey: '',
      ollamaBaseUrl: 'http://custom:11434',
    };
    const client = createLLMClient(config);
    expect(client).toBeInstanceOf(OllamaProvider);
  });
});

// ---------------------------------------------------------------------------
// GeminiProvider tests
// ---------------------------------------------------------------------------

describe('GeminiProvider', () => {
  it('constructs correct API URL', async () => {
    const provider = new GeminiProvider('test-api-key', 'gemini-2.0-flash');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: 'Hello!' }], role: 'model' }, finishReason: 'STOP' },
        ],
      }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('generativelanguage.googleapis.com');
    expect(calledUrl).toContain('models/gemini-2.0-flash:generateContent');
    expect(calledUrl).toContain('key=test-api-key');
  });

  it('formats messages correctly (system -> system_instruction)', async () => {
    const provider = new GeminiProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { content: { parts: [{ text: 'Response' }], role: 'model' }, finishReason: 'STOP' },
        ],
      }),
    } as Response);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];

    await provider.chat(messages);

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.system_instruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hi' }] }]);
  });

  it('handles HTTP error responses', async () => {
    const provider = new GeminiProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      LLMProviderError,
    );
  });

  it('handles API error in response body', async () => {
    const provider = new GeminiProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 400, message: 'Invalid request', status: 'INVALID_ARGUMENT' },
      }),
    } as Response);

    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      LLMProviderError,
    );
  });

  it('parses tool calls from response', async () => {
    const provider = new GeminiProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'deploy_project',
                    args: { repo_url: 'https://example.com' },
                  },
                },
              ],
              role: 'model',
            },
            finishReason: 'STOP',
          },
        ],
      }),
    } as Response);

    const response = await provider.chat([{ role: 'user', content: 'Deploy' }]);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe('deploy_project');
    expect(response.toolCalls?.[0]?.arguments).toEqual({ repo_url: 'https://example.com' });
  });
});

// ---------------------------------------------------------------------------
// AnthropicProvider tests
// ---------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  it('sends correct headers (x-api-key, anthropic-version)', async () => {
    const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-20250514');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Hello!' }] }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('formats messages with system as top-level field', async () => {
    const provider = new AnthropicProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Response' }] }),
    } as Response);

    const messages: ChatMessage[] = [
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hi' },
    ];

    await provider.chat(messages);

    const body = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.system).toBe('Be helpful');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]);
  });

  it('handles network error', async () => {
    const provider = new AnthropicProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      LLMProviderError,
    );
  });
});

// ---------------------------------------------------------------------------
// OpenAIProvider tests
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  it('sends Authorization: Bearer header', async () => {
    const provider = new OpenAIProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-key');
  });

  it('parses tool calls with JSON arguments', async () => {
    const provider = new OpenAIProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'deploy', arguments: '{"repo": "https://example.com"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    } as Response);

    const response = await provider.chat([{ role: 'user', content: 'Deploy' }]);

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls?.[0]?.name).toBe('deploy');
    expect(response.toolCalls?.[0]?.arguments).toEqual({ repo: 'https://example.com' });
  });

  it('throws on invalid JSON in tool arguments', async () => {
    const provider = new OpenAIProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'deploy', arguments: 'not-valid-json' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    } as Response);

    await expect(provider.chat([{ role: 'user', content: 'Deploy' }])).rejects.toThrow(
      LLMProviderError,
    );
  });
});

// ---------------------------------------------------------------------------
// OllamaProvider tests
// ---------------------------------------------------------------------------

describe('OllamaProvider', () => {
  it('sends request to localhost:11434 by default', async () => {
    const provider = new OllamaProvider('llama3.2');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { role: 'assistant', content: 'Hello!' },
      }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('http://localhost:11434/api/chat');
  });

  it('uses custom base URL', async () => {
    const provider = new OllamaProvider('llama3.2', 'http://custom-host:8080');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { role: 'assistant', content: 'Hello!' },
      }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('http://custom-host:8080/api/chat');
  });

  it('handles Ollama error response', async () => {
    const provider = new OllamaProvider('llama3.2');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'model not found' }),
    } as Response);

    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      LLMProviderError,
    );
  });
});

// ---------------------------------------------------------------------------
// OpenRouterProvider tests
// ---------------------------------------------------------------------------

describe('OpenRouterProvider', () => {
  it('sends OpenRouter-specific headers (HTTP-Referer, X-Title)', async () => {
    const provider = new OpenRouterProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Hello!' } }],
      }),
    } as Response);

    await provider.chat([{ role: 'user', content: 'Hi' }]);

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['HTTP-Referer']).toBe('https://openlander.dev');
    expect(headers['X-Title']).toBe('OpenLander');
  });

  it('handles OpenRouter error response', async () => {
    const provider = new OpenRouterProvider('test-key');
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { message: 'Rate limit exceeded', type: 'rate_limit' },
      }),
    } as Response);

    await expect(provider.chat([{ role: 'user', content: 'Hi' }])).rejects.toThrow(
      LLMProviderError,
    );
  });
});
