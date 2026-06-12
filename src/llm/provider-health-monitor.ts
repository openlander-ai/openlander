import type { AppContext } from '../app.js';
import { normalizeLlmConfig } from '../config/index.js';
import { resolveProviderApiKey, type LLMProviderEntry } from './model-registry.js';
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

const BLOCKED_AI_PROVIDER_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::',
  '::1',
  '0:0:0:0:0:0:0:0',
  '0:0:0:0:0:0:0:1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
]);

export function checkLlmProviderBaseUrlSafety(baseURL: string | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (!baseURL) {
    return { ok: true };
  }

  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    return { ok: false, reason: 'base_url must be a valid URL' };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, reason: `scheme ${scheme} is not allowed` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'embedded credentials are not allowed' };
  }

  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.+$/, '');
  if (!host) {
    return { ok: false, reason: 'empty host' };
  }

  if (BLOCKED_AI_PROVIDER_HOSTS.has(host)) {
    return { ok: false, reason: `host ${host} is not a safe provider target` };
  }

  if (host.endsWith('.local') || host.endsWith('.localhost')) {
    return { ok: false, reason: `host ${host} resolves on the local network` };
  }

  if (/^127\./.test(host) || /^0\./.test(host) || /^169\.254\./.test(host)) {
    return { ok: false, reason: `host ${host} is not a safe provider target` };
  }

  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('::ffff:')
    ) {
      return { ok: false, reason: `host ${host} is not a safe provider target` };
    }
  }

  return { ok: true };
}

export async function testLlmProviderEntry(
  entry: LLMProviderEntry,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<ProviderHealthStatus> {
  const start = Date.now();
  try {
    const baseUrlSafety = checkLlmProviderBaseUrlSafety(entry.baseURL);
    if (!baseUrlSafety.ok) {
      throw new Error(`Unsafe AI provider base_url: ${baseUrlSafety.reason ?? 'unsafe URL'}`);
    }

    const model = createModel({
      provider: entry.provider,
      apiKey: resolveProviderApiKey(entry),
      authToken: entry.authToken,
      model: entry.defaultModel,
      ...(entry.baseURL ? { baseURL: entry.baseURL } : {}),
    });

    const { generateText } = await import('ai');
    await generateText({
      model,
      prompt: 'Respond with exactly: ok',
      maxOutputTokens: 5,
      abortSignal: AbortSignal.timeout(timeoutMs),
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
          const status = await testLlmProviderEntry(entry);
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
}
