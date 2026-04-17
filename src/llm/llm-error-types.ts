/**
 * LLM Error Classification System
 *
 * Classifies LLM errors into actionable categories for circuit breaker
 * and recovery decision-making.
 */

export enum LlmErrorType {
  /** Rate limit or concurrency limit exceeded (429, 1302) */
  RATE_LIMIT = 'RATE_LIMIT',

  /** Quota exhausted (1311, plan limit) */
  QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',

  /** Authentication failure (401, invalid API key) */
  AUTH_FAILURE = 'AUTH_FAILURE',

  /** Model not found or invalid (404, 1211) */
  MODEL_INVALID = 'MODEL_INVALID',

  /** Context window overflow (context too long) */
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',

  /** Network error (timeout, connection refused) */
  NETWORK_ERROR = 'NETWORK_ERROR',

  /** Provider-specific error (5xx, service unavailable) */
  PROVIDER_ERROR = 'PROVIDER_ERROR',

  /** Unknown or unclassified error */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Classify an LLM error into a specific type.
 *
 * Checks HTTP status codes, error messages, and provider-specific error codes.
 * Z.AI error codes:
 *   - 1211: model_invalid
 *   - 1302: rate_limit / concurrency_limit
 *   - 1311: plan_limit / quota_exhausted
 *
 * @param error - The error object (Error, string, or unknown)
 * @returns LlmErrorType classification
 */
export function classifyLlmError(error: unknown): LlmErrorType {
  const message = extractErrorMessage(error);
  const statusCode = extractStatusCode(error);

  // Check HTTP status codes first
  if (statusCode === 401 || statusCode === 403) {
    return LlmErrorType.AUTH_FAILURE;
  }

  if (statusCode === 404) {
    return LlmErrorType.MODEL_INVALID;
  }

  if (statusCode === 429) {
    return LlmErrorType.RATE_LIMIT;
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return LlmErrorType.PROVIDER_ERROR;
  }

  // Rate limit patterns: "rate limit", "too many", "quota", "concurrency"
  if (/rate.limit|too many|concurrency|429/i.test(message)) {
    return LlmErrorType.RATE_LIMIT;
  }

  // Quota exhausted patterns: "quota", "exceeded", "plan limit"
  if (/quota|exceeded|plan.limit|1311/i.test(message)) {
    return LlmErrorType.QUOTA_EXHAUSTED;
  }

  // Auth failure patterns: "unauthorized", "invalid.*key", "authentication"
  if (/unauthorized|invalid.*key|authentication|401|403/i.test(message)) {
    return LlmErrorType.AUTH_FAILURE;
  }

  // Model invalid patterns: "model", "not found", "1211"
  if (/model.*not.found|unknown.model|invalid.model|1211/i.test(message)) {
    return LlmErrorType.MODEL_INVALID;
  }

  // Context overflow patterns: "context", "token", "too long", "overflow"
  if (/context.*(too.long|overflow|exceeds)|token.*limit|max.tokens/i.test(message)) {
    return LlmErrorType.CONTEXT_OVERFLOW;
  }

  // Network error patterns: "timeout", "econnrefused", "enotfound", "network"
  if (/timeout|econnrefused|enotfound|network|connection|socket/i.test(message)) {
    return LlmErrorType.NETWORK_ERROR;
  }

  // Provider error patterns: "service unavailable", "internal error", "bad gateway"
  if (/service.unavailable|internal.error|bad.gateway|502|503|504/i.test(message)) {
    return LlmErrorType.PROVIDER_ERROR;
  }

  return LlmErrorType.UNKNOWN;
}

/**
 * Sanitize an LLM error message by removing sensitive information.
 *
 * Removes:
 *   - API keys (32+ alphanumeric characters)
 *   - Bearer tokens
 *   - Common credential patterns
 *
 * @param message - The error message to sanitize
 * @returns Sanitized message with credentials removed
 */
export function sanitizeLlmErrorMessage(message: string): string {
  let sanitized = message;

  // Remove API keys (32+ alphanumeric chars)
  sanitized = sanitized.replace(/[A-Za-z0-9]{32,}/g, '***');

  // Remove Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');

  // Remove common credential patterns
  sanitized = sanitized.replace(/api[_-]?key[=:]\s*[^\s,}]+/gi, 'api_key=***');
  sanitized = sanitized.replace(/password[=:]\s*[^\s,}]+/gi, 'password=***');
  sanitized = sanitized.replace(/token[=:]\s*[^\s,}]+/gi, 'token=***');

  return sanitized;
}

/**
 * Extract error message from various error types.
 *
 * @param error - Error object, string, or unknown
 * @returns Error message string
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return obj.message;
    }
    if (typeof obj.error === 'string') {
      return obj.error;
    }
  }

  return String(error);
}

/**
 * Extract HTTP status code from error object.
 *
 * @param error - Error object
 * @returns HTTP status code or undefined
 */
function extractStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;

    // Check common status code properties
    if (typeof obj.status === 'number') {
      return obj.status;
    }
    if (typeof obj.statusCode === 'number') {
      return obj.statusCode;
    }
    if (typeof obj.code === 'number') {
      return obj.code;
    }

    // Check nested response object
    if (obj.response && typeof obj.response === 'object') {
      const resp = obj.response as Record<string, unknown>;
      if (typeof resp.status === 'number') {
        return resp.status;
      }
      if (typeof resp.statusCode === 'number') {
        return resp.statusCode;
      }
    }
  }

  return undefined;
}
