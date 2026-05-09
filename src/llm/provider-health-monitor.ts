import type { AppContext } from '../app.js';
import { normalizeLlmConfig } from '../config/index.js';
import type { LLMProviderEntry } from './model-registry.js';
import { createModel } from './index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('provider-health-monitor');

/** Per-provider health check result, stored in-memory only. */
export interface ProviderHealthStatus {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const MIN_INTERVAL_MS = 300_000;
const INITIAL_DELAY_MS = 15_000;

/**
 * Background monitor that periodically tests LLM provider connectivity.
 *
 * Results are stored in an in-memory Map (never persisted to config.json).
 * Health check failures are NOT counted as circuit breaker failures (T8 handles that).
 */
export class ProviderHealthMonitor {
  private readonly healthState = new Map<string, ProviderHealthStatus>();
  private intervalId?: ReturnType<typeof setInterval>;
  private initialTimerId?: ReturnType<typeof setTimeout>;
  private checking = false;

  start(ctx: AppContext, intervalMs = 300_000): void {
    if (this.intervalId) {
      return;
    }

    const safeInterval = Math.max(intervalMs, MIN_INTERVAL_MS);

    this.intervalId = setInterval(() => {
      void this.checkAll(ctx);
    }, safeInterval);

    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      void this.checkAll(ctx);
    }, INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.initialTimerId) {
      clearTimeout(this.initialTimerId);
      this.initialTimerId = undefined;
    }

    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  async checkAll(ctx: AppContext): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const normalized = normalizeLlmConfig(ctx.config.llm);
      const entries = Object.entries(normalized.providers);
      if (entries.length === 0) {
        return;
      }

      await Promise.allSettled(
        entries.map(async ([id, entry]) => {
          const status = await this.testProvider(entry);
          this.healthState.set(id, status);

          if (!status.ok) {
            log.warn({ providerId: id, error: status.error }, 'Provider health check failed');
          } else {
            log.debug({ providerId: id, latencyMs: status.latencyMs }, 'Provider health check OK');
          }
        }),
      );
    } finally {
      this.checking = false;
    }
  }

  getHealth(providerId: string): ProviderHealthStatus | null {
    return this.healthState.get(providerId) ?? null;
  }

  getAllHealth(): Map<string, ProviderHealthStatus> {
    return this.healthState;
  }

  private async testProvider(entry: LLMProviderEntry): Promise<ProviderHealthStatus> {
    const start = Date.now();
    try {
      const model = createModel({
        provider: entry.provider,
        apiKey: entry.apiKey ?? '',
        authToken: entry.authToken,
        model: entry.defaultModel,
      });

      const { generateText } = await import('ai');
      await generateText({
        model,
        prompt: 'Respond with exactly: ok',
        maxOutputTokens: 5,
        abortSignal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });

      return { ok: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
      };
    }
  }
}
