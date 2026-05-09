import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmCircuitBreaker } from '../../src/llm/llm-circuit-breaker.js';
import { LlmErrorType } from '../../src/llm/llm-error-types.js';

describe('LlmCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after reaching the failure threshold', () => {
    const breaker = new LlmCircuitBreaker();

    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);

    expect(breaker.canCall('provider-1')).toBe(false);
    expect(breaker.getStatus('provider-1')).toMatchObject({
      state: 'open',
      failureCount: 3,
    });
  });

  it('moves to half_open after the cooldown expires', () => {
    const breaker = new LlmCircuitBreaker();

    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);

    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(breaker.canCall('provider-1')).toBe(true);
    expect(breaker.getStatus('provider-1')).toMatchObject({
      state: 'half_open',
      failureCount: 0,
    });
  });

  it('resets to closed after a success', () => {
    const breaker = new LlmCircuitBreaker();

    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('provider-1', LlmErrorType.PROVIDER_ERROR);
    breaker.recordSuccess('provider-1');

    expect(breaker.canCall('provider-1')).toBe(true);
    expect(breaker.getStatus('provider-1')).toEqual({
      state: 'closed',
      failureCount: 0,
    });
  });

  it('does not count health check failures', () => {
    const breaker = new LlmCircuitBreaker();

    breaker.recordFailure('provider-1', LlmErrorType.NETWORK_ERROR, { isHealthCheck: true });

    expect(breaker.canCall('provider-1')).toBe(true);
    expect(breaker.getStatus('provider-1')).toEqual({
      state: 'closed',
      failureCount: 0,
    });
  });
});
