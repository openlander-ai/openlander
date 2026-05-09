import { describe, it, expect } from 'vitest';
import { isLlmUnreachableError, LLMUnreachableError } from '../../src/errors.js';

describe('LLMUnreachableError and isLlmUnreachableError — Fix 2', () => {
  it('LLMUnreachableError has correct code and status', () => {
    const err = new LLMUnreachableError('ollama', 'ECONNREFUSED');
    expect(err.name).toBe('LLMUnreachableError');
    expect(err.code).toBe('LLM_UNREACHABLE');
    expect(err.statusCode).toBe(503);
    expect(err.message).toContain('ollama');
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('isLlmUnreachableError detects ECONNREFUSED error code', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    });
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError detects ENOTFOUND error code', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), {
      code: 'ENOTFOUND',
    });
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError detects EHOSTUNREACH error code', () => {
    const err = Object.assign(new Error('connect EHOSTUNREACH'), { code: 'EHOSTUNREACH' });
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError detects AI SDK RetryError by name', () => {
    const err = Object.assign(new Error('RetryError: too many retries'), { name: 'AI_RetryError' });
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError detects message containing ECONNREFUSED', () => {
    const err = new Error('fetch failed: ECONNREFUSED ::1:11434');
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError detects LLMUnreachableError instance', () => {
    const err = new LLMUnreachableError('ollama', 'connection refused');
    expect(isLlmUnreachableError(err)).toBe(true);
  });

  it('isLlmUnreachableError returns false for unrelated errors', () => {
    expect(isLlmUnreachableError(new Error('syntax error'))).toBe(false);
    expect(isLlmUnreachableError(new Error('undefined is not a function'))).toBe(false);
    expect(isLlmUnreachableError(null)).toBe(false);
    expect(isLlmUnreachableError('string error')).toBe(false);
  });

  it('isLlmUnreachableError checks nested cause', () => {
    const cause = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const wrapper = new Error('fetch failed');
    (wrapper as Error & { cause: unknown }).cause = cause;
    expect(isLlmUnreachableError(wrapper)).toBe(true);
  });
});
