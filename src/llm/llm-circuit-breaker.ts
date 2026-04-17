/**
 * LLM Circuit Breaker Interface & Types
 *
 * Defines the circuit breaker pattern for LLM provider health management.
 * Implementation in T8 (llm-circuit-breaker-impl.ts).
 *
 * States:
 *   - closed: Normal operation, all calls allowed
 *   - open: Provider failing, calls rejected immediately
 *   - half_open: Testing recovery, limited calls allowed
 */

import type { LlmErrorType } from './llm-error-types.js';

/**
 * Circuit breaker state machine.
 */
export type LlmCircuitBreakerState = 'closed' | 'open' | 'half_open';

/**
 * Configuration for circuit breaker behavior.
 */
export interface LlmCircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 3) */
  failureThreshold: number;

  /** Time window for counting failures in milliseconds (default: 300_000 = 5 min) */
  windowMs: number;

  /** Time to wait before transitioning to half_open in milliseconds (default: 600_000 = 10 min) */
  cooldownMs: number;
}

/**
 * Options for recording LLM calls.
 */
export interface LlmCallOptions {
  /** If true, failure does not increment failure count (for health checks) */
  isHealthCheck?: boolean;
}

/**
 * Status snapshot of a provider's circuit breaker.
 */
export interface LlmCircuitBreakerStatus {
  /** Current state (closed, open, half_open) */
  state: LlmCircuitBreakerState;

  /** Number of failures in current window */
  failureCount: number;

  /** Milliseconds remaining until cooldown expires (only when open) */
  cooldownRemainingMs?: number;
}

/**
 * LLM Circuit Breaker
 *
 * Tracks provider health and prevents cascading failures.
 * Per-provider state machine with configurable thresholds.
 *
 * Usage:
 *   const cb = new LlmCircuitBreaker({ failureThreshold: 3, windowMs: 300_000 });
 *   if (cb.canCall('provider-id')) {
 *     try {
 *       await callLlm();
 *       cb.recordSuccess('provider-id');
 *     } catch (error) {
 *       cb.recordFailure('provider-id', classifyLlmError(error));
 *     }
 *   }
 */
export class LlmCircuitBreaker {
  /**
   * Create a new circuit breaker with optional config.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: Partial<LlmCircuitBreakerConfig>) {
    void config; // Stub: implementation in T8
  }

  /**
   * Record a failure for a provider.
   *
   * Increments failure count and may transition to open state.
   * Health check failures are not counted.
   *
   * @param providerId - Provider identifier
   * @param errorType - Classified error type
   * @param options - Optional call options
   */
  recordFailure(providerId: string, errorType: LlmErrorType, options?: LlmCallOptions): void {
    void providerId;
    void errorType;
    void options;
    // Stub: implementation in T8
  }

  /**
   * Record a successful call for a provider.
   *
   * Resets failure count and may transition to closed state.
   *
   * @param providerId - Provider identifier
   */
  recordSuccess(providerId: string): void {
    void providerId;
    // Stub: implementation in T8
  }

  /**
   * Check if a provider can accept calls.
   *
   * Returns false if circuit is open and cooldown has not expired.
   *
   * @param providerId - Provider identifier
   * @returns true if calls are allowed, false if circuit is open
   */
  canCall(providerId: string): boolean {
    void providerId;
    return true; // Stub: always allow in interface
  }

  /**
   * Get the current status of a provider's circuit breaker.
   *
   * @param providerId - Provider identifier
   * @returns Status snapshot
   */
  getStatus(providerId: string): LlmCircuitBreakerStatus {
    void providerId;
    // Stub: implementation in T8
    return {
      state: 'closed',
      failureCount: 0,
    };
  }
}
