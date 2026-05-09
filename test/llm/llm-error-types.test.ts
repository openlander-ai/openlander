import { describe, expect, it } from 'vitest';

import {
  classifyLlmError,
  LlmErrorType,
  sanitizeLlmErrorMessage,
} from '../../src/llm/llm-error-types.js';

describe('classifyLlmError', () => {
  it('classifies HTTP 429 as rate limit', () => {
    expect(classifyLlmError({ status: 429, message: 'Too many requests' })).toBe(
      LlmErrorType.RATE_LIMIT,
    );
  });

  it('classifies HTTP 401 as auth failure', () => {
    expect(classifyLlmError({ response: { status: 401 }, message: 'Unauthorized' })).toBe(
      LlmErrorType.AUTH_FAILURE,
    );
  });

  it('classifies HTTP 400 model errors as model invalid', () => {
    expect(classifyLlmError({ status: 400, message: 'Invalid model parameter provided' })).toBe(
      LlmErrorType.MODEL_INVALID,
    );
  });

  it('classifies Z.AI error code 1302 as rate limit', () => {
    expect(classifyLlmError({ code: 1302, message: 'concurrency limit exceeded' })).toBe(
      LlmErrorType.RATE_LIMIT,
    );
  });

  it('classifies Z.AI error code 1211 as model invalid', () => {
    expect(classifyLlmError({ code: 1211, message: 'model not found' })).toBe(
      LlmErrorType.MODEL_INVALID,
    );
  });

  it('classifies Z.AI error code 1311 as quota exhausted', () => {
    expect(classifyLlmError({ code: 1311, message: 'plan limit reached' })).toBe(
      LlmErrorType.QUOTA_EXHAUSTED,
    );
  });

  it('classifies network errors', () => {
    expect(classifyLlmError(new Error('socket timeout while connecting'))).toBe(
      LlmErrorType.NETWORK_ERROR,
    );
  });

  it('classifies unknown errors', () => {
    expect(classifyLlmError({ message: 'unexpected llama chaos' })).toBe(LlmErrorType.UNKNOWN);
  });
});

describe('sanitizeLlmErrorMessage', () => {
  it('redacts API key-like secrets', () => {
    const raw =
      'Request failed with api_key=sk-super-secret and Bearer abc.def and token=1234567890abcdefghijklmnopqrstuvwxyz';

    expect(sanitizeLlmErrorMessage(raw)).toBe(
      'Request failed with api_key=*** and Bearer *** and token=***',
    );
  });
});
