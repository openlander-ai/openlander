import pino from 'pino';
import { Writable } from 'node:stream';
import { getLogBuffer } from './log-buffer.js';

const isTest = process.env['NODE_ENV'] === 'test';

function parseLogLine(line: string):
  | Partial<{
      level: number;
      module: string;
      msg: string;
      time: number;
      timestamp: number;
    }>
  | undefined {
  try {
    return JSON.parse(line) as Partial<{
      level: number;
      module: string;
      msg: string;
      time: number;
      timestamp: number;
    }>;
  } catch (_parseError) {
    return undefined;
  }
}

class LogCaptureStream extends Writable {
  constructor(private readonly output?: NodeJS.WritableStream) {
    super();
  }

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = text.split('\n').filter((line) => line.trim().length > 0);

    for (const line of lines) {
      const parsed = parseLogLine(line);
      if (parsed === undefined) {
        continue;
      }

      if (typeof parsed.level === 'number' && typeof parsed.msg === 'string') {
        getLogBuffer().push({
          level: parsed.level,
          module: typeof parsed.module === 'string' ? parsed.module : undefined,
          msg: parsed.msg,
          timestamp:
            typeof parsed.time === 'number'
              ? parsed.time
              : typeof parsed.timestamp === 'number'
                ? parsed.timestamp
                : Date.now(),
        });
      }
    }

    if (this.output !== undefined) {
      this.output.write(text);
    }

    callback();
  }
}

/**
 * Day 13 hardening: redact common credential field names so a stray
 * `log.info({ user })` or `log.error({ err, body })` never serialises a
 * password, OAuth token, or API key into the on-disk JSON stream / log
 * buffer / log-stream WebSocket. Pino redact paths are matched per token
 * (`*.password` covers any one-level child); we deliberately use `*` for
 * all common nesting points and explicit deep paths for the well-known
 * HTTP request shape.
 */
const REDACT_PATHS: string[] = [
  // Generic credential field names (one level deep)
  '*.password',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.auth_token',
  '*.authToken',
  '*.secret',
  '*.access_token',
  '*.accessToken',
  '*.refresh_token',
  '*.refreshToken',
  '*.client_secret',
  '*.clientSecret',
  '*.signing_secret',
  '*.signingSecret',
  '*.webhook_secret',
  '*.webhookSecret',
  '*.private_key',
  '*.privateKey',
  '*.session_token',
  '*.sessionToken',
  // OpenLander-specific shapes
  'setupSecret',
  'apiToken',
  'oauth_code',
  'oauthCode',
  'verifier',
  'pkce_verifier',
  'pkceVerifier',
  // HTTP request leakage
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export const logger = pino(
  {
    level: isTest ? 'silent' : (process.env['LOG_LEVEL'] ?? 'info'),
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  },
  new LogCaptureStream(isTest ? undefined : process.stdout),
);

export function createModuleLogger(module: string): pino.Logger {
  return logger.child({ module });
}
