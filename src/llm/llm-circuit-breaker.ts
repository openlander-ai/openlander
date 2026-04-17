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

interface ProviderState {
  state: LlmCircuitBreakerState;
  failures: number[];
  openedAt?: number;
}

const DEFAULT_CONFIG: Required<LlmCircuitBreakerConfig> = {
  failureThreshold: 3,
  windowMs: 300_000,
  cooldownMs: 600_000,
};

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
  private readonly config: Required<LlmCircuitBreakerConfig>;
  private readonly state = new Map<string, ProviderState>();

  /**
   * Create a new circuit breaker with optional config.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: Partial<LlmCircuitBreakerConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
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
    void errorType;

    if (options?.isHealthCheck) {
      return;
    }

    const providerState = this.getOrCreateState(providerId);
    const now = Date.now();
    providerState.failures.push(now);
    this.pruneFailures(providerState, now);

    if (
      providerState.state === 'half_open' ||
      providerState.failures.length >= this.config.failureThreshold
    ) {
      providerState.state = 'open';
      providerState.openedAt = now;
    }
  }

  /**
   * Record a successful call for a provider.
   *
   * Resets failure count and may transition to closed state.
   *
   * @param providerId - Provider identifier
   */
  recordSuccess(providerId: string): void {
    this.state.set(providerId, {
      state: 'closed',
      failures: [],
    });
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
    const providerState = this.getOrCreateState(providerId);
    const now = Date.now();
    this.pruneFailures(providerState, now);

    if (providerState.state === 'closed' || providerState.state === 'half_open') {
      return true;
    }

    if (providerState.openedAt === undefined) {
      providerState.openedAt = now;
    }

    if (now - providerState.openedAt >= this.config.cooldownMs) {
      providerState.state = 'half_open';
      providerState.openedAt = undefined;
      return true;
    }

    return false;
  }

  /**
   * Get the current status of a provider's circuit breaker.
   *
   * @param providerId - Provider identifier
   * @returns Status snapshot
   */
  getStatus(providerId: string): LlmCircuitBreakerStatus {
    const providerState = this.getOrCreateState(providerId);
    const now = Date.now();
    this.pruneFailures(providerState, now);

    const status: LlmCircuitBreakerStatus = {
      state: providerState.state,
      failureCount: providerState.failures.length,
    };

    if (providerState.state === 'open' && providerState.openedAt !== undefined) {
      status.cooldownRemainingMs = Math.max(
        0,
        this.config.cooldownMs - (now - providerState.openedAt),
      );
    }

    return status;
  }

  private getOrCreateState(providerId: string): ProviderState {
    const existing = this.state.get(providerId);
    if (existing) {
      return existing;
    }

    const initialState: ProviderState = {
      state: 'closed',
      failures: [],
    };
    this.state.set(providerId, initialState);
    return initialState;
  }

  private pruneFailures(providerState: ProviderState, now: number): void {
    providerState.failures = providerState.failures.filter(
      (timestamp) => now - timestamp <= this.config.windowMs,
    );

    if (providerState.state === 'closed' && providerState.failures.length === 0) {
      providerState.openedAt = undefined;
    }
  }
}
