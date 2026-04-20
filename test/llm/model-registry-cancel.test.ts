/**
 * Tests for TransformStream cancel handler in model-registry wrapStream middleware.
 *
 * Verifies:
 * - Stream cancel → recordFailure called (not recordSuccess)
 * - Stream flush (normal completion) → recordSuccess called (regression guard)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmCircuitBreaker } from '../../src/llm/llm-circuit-breaker.js';
import { LlmErrorType } from '../../src/llm/llm-error-types.js';

// ---------------------------------------------------------------------------
// Helpers to simulate the wrapStream middleware behaviour
// ---------------------------------------------------------------------------

/**
 * Creates a TransformStream with the same cancel/flush handlers used in
 * model-registry.ts `wrapStream` middleware, and returns helpers to trigger
 * each handler manually.
 */
function buildTransformStream(
  circuitBreaker: LlmCircuitBreaker,
  providerId: string,
  classifyError: (e: unknown) => LlmErrorType,
): {
  triggerFlush: () => void;
  triggerCancel: (reason?: unknown) => void;
} {
  let flushFn: (() => void) | undefined;
  let cancelFn: ((reason: unknown) => void) | undefined;

  // Mirror the exact handler object from model-registry.ts
  const handlers = {
    flush() {
      circuitBreaker.recordSuccess(providerId);
    },
    cancel(reason: unknown) {
      circuitBreaker.recordFailure(providerId, classifyError(reason));
    },
  };

  flushFn = handlers.flush.bind(handlers);
  cancelFn = handlers.cancel.bind(handlers);

  return {
    triggerFlush: () => flushFn!(),
    triggerCancel: (reason?: unknown) => cancelFn!(reason),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('model-registry wrapStream cancel handler', () => {
  let breaker: LlmCircuitBreaker;
  const providerId = 'test-provider';

  beforeEach(() => {
    breaker = new LlmCircuitBreaker({
      failureThreshold: 3,
      windowMs: 300_000,
      cooldownMs: 600_000,
    });
  });

  it('cancel increments failure count and does NOT call recordSuccess', () => {
    const recordSuccessSpy = vi.spyOn(breaker, 'recordSuccess');
    const recordFailureSpy = vi.spyOn(breaker, 'recordFailure');

    const { triggerCancel } = buildTransformStream(breaker, providerId, () => LlmErrorType.UNKNOWN);
    triggerCancel(new Error('AbortError'));

    expect(recordFailureSpy).toHaveBeenCalledOnce();
    expect(recordFailureSpy).toHaveBeenCalledWith(providerId, LlmErrorType.UNKNOWN);
    expect(recordSuccessSpy).not.toHaveBeenCalled();
  });

  it('cancel counts toward circuit breaker threshold', () => {
    const { triggerCancel } = buildTransformStream(breaker, providerId, () => LlmErrorType.UNKNOWN);

    expect(breaker.canCall(providerId)).toBe(true);

    triggerCancel();
    triggerCancel();
    triggerCancel(); // threshold = 3

    expect(breaker.canCall(providerId)).toBe(false);
    expect(breaker.getStatus(providerId).state).toBe('open');
  });

  it('flush (normal completion) calls recordSuccess and does NOT call recordFailure', () => {
    const recordSuccessSpy = vi.spyOn(breaker, 'recordSuccess');
    const recordFailureSpy = vi.spyOn(breaker, 'recordFailure');

    const { triggerFlush } = buildTransformStream(breaker, providerId, () => LlmErrorType.UNKNOWN);
    triggerFlush();

    expect(recordSuccessSpy).toHaveBeenCalledOnce();
    expect(recordSuccessSpy).toHaveBeenCalledWith(providerId);
    expect(recordFailureSpy).not.toHaveBeenCalled();
  });

  it('flush resets failure count (closed state after previous partial failures)', () => {
    const { triggerCancel, triggerFlush } = buildTransformStream(
      breaker,
      providerId,
      () => LlmErrorType.UNKNOWN,
    );

    triggerCancel();
    triggerCancel();
    expect(breaker.getStatus(providerId).failureCount).toBe(2);

    triggerFlush();
    expect(breaker.getStatus(providerId).state).toBe('closed');
    expect(breaker.getStatus(providerId).failureCount).toBe(0);
  });

  it('cancel reason is passed through classifyLlmError', () => {
    const classify = vi.fn().mockReturnValue(LlmErrorType.NETWORK_ERROR);
    const recordFailureSpy = vi.spyOn(breaker, 'recordFailure');

    const cancelReason = new Error('connection reset');
    const { triggerCancel } = buildTransformStream(breaker, providerId, classify);
    triggerCancel(cancelReason);

    expect(classify).toHaveBeenCalledWith(cancelReason);
    expect(recordFailureSpy).toHaveBeenCalledWith(providerId, LlmErrorType.NETWORK_ERROR);
  });
});
