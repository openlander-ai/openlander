type Translate = (key: string, params?: Record<string, string | number>) => string;

const LEGACY_ERROR_CODES: Record<string, string> = {
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  'Container is not running': 'CONTAINER_NOT_RUNNING',
  'No shell available (/bin/bash and /bin/sh not found). This container may be a distroless image.':
    'SHELL_UNAVAILABLE',
  'Terminal idle timeout (30m)': 'TERMINAL_IDLE_TIMEOUT',
  'Failed to open terminal session': 'TERMINAL_OPEN_FAILED',
  'Rate limit exceeded': 'RATE_LIMIT_EXCEEDED',
};

const SAFE_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * String WebSocket frames are reserved for terminal control messages;
 * shell output is sent as binary. Localize known control errors while
 * retaining their stable code for support and diagnostics.
 */
export function formatTerminalControlFrame(raw: string, t: Translate): string {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return raw;
  const record = payload as Record<string, unknown>;
  if (record.type !== 'error') return raw;

  const message = typeof record.message === 'string' ? record.message : '';
  const wireCode =
    typeof record.code === 'string' && SAFE_CODE.test(record.code) ? record.code : '';
  const code = wireCode || LEGACY_ERROR_CODES[message] || '';
  const key = code ? `logs.terminalServerError.codes.${code}` : '';
  const translated = key ? t(key) : '';
  const visible =
    translated && translated !== key ? translated : t('logs.terminalServerError.generic');
  const diagnosticCode = code ? ` (${code})` : '';
  return `\r\n\x1b[31m${visible}${diagnosticCode}\x1b[0m`;
}
