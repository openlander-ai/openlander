import { sleep } from '../../lib/sleep.js';

export interface WaitUntilReadyOptions {
  /** Max number of attempts (default: 30) */
  maxAttempts?: number;
  /** Interval between attempts in ms (default: 1000) */
  intervalMs?: number;
  /** Description for error message, e.g. "PostgreSQL service abc123" */
  description?: string;
}

/**
 * Retry a check function until it succeeds or max attempts are exhausted.
 * The check function should resolve on success, or throw on failure (will be retried).
 */
export async function waitUntilReady(
  check: () => Promise<void>,
  options?: WaitUntilReadyOptions,
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 30;
  const intervalMs = options?.intervalMs ?? 1000;
  const description = options?.description ?? 'Service';

  let lastError = '';

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(intervalMs);
  }

  throw new Error(`${description} is not ready${lastError ? ` (${lastError})` : ''}`);
}
