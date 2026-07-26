import { ApiError } from './api/client';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Keep the visible error in the selected locale while retaining a stable
 * diagnostic identifier for developer users. Unknown server prose is still
 * available in the network response and the original Error object.
 */
export function localizeApiError(
  error: unknown,
  t: Translate,
  fallbackKey: string,
  codeKeyPrefix: string,
): string {
  const fallback = t(fallbackKey);
  if (!(error instanceof ApiError)) return fallback;

  if (error.code) {
    const key = `${codeKeyPrefix}.${error.code}`;
    const translated = t(key);
    if (translated !== key) return `${translated} (${error.code})`;
    return `${fallback} (${error.code})`;
  }

  return `${fallback} (HTTP ${String(error.status)})`;
}
