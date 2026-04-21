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
 * Day 13 + Day 14 follow-up hardening: redact common credential field
 * names so a stray `log.info({ user })` or `log.error({ err, body })`
 * never serialises a password, OAuth token, or API key into the on-disk
 * JSON stream / log buffer / log-stream WebSocket.
 *
 * Pino supports two wildcard placements: a leading `*.<field>` matches
 * any one-level child (`{ user: { password } }` and `{ body: { password } }`
 * both get caught), and an intermediate `<root>.*.<field>` matches one
 * level of nesting under the root. The Day 14 cross-check found that
 * `*.password` does NOT catch `req.body.password` (two levels deep), so
 * the well-known HTTP shapes get explicit deep paths added below.
 *
 * The list intentionally errs on the side of redacting too many fields:
 * a redacted log line is recoverable from the source code, a leaked
 * credential is not.
 */
const CREDENTIAL_FIELD_NAMES: string[] = [
  'password',
  'token',
  'api_key',
  'apiKey',
  'auth_token',
  'authToken',
  'secret',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'signing_secret',
  'signingSecret',
  'webhook_secret',
  'webhookSecret',
  'private_key',
  'privateKey',
  'session_token',
  'sessionToken',
];

/**
 * Containers we expect to wrap credential-bearing payloads. Each gets a
 * deep path generated for every credential field name above so that
 * `req.body.password` / `request.body.token` / `body.body.api_key`
 * etc. all redact correctly. Pino's matcher does not collapse arbitrary
 * depths via a single `**` wildcard, so we enumerate the shapes we
 * actually log.
 */
const NESTED_CREDENTIAL_CONTAINERS: string[] = [
  'req.body',
  'request.body',
  'res.body',
  'response.body',
  'body.body',
  'data.body',
  '*.body',
  'req.query',
  'request.query',
  '*.query',
  'req.params',
  'request.params',
];

const REDACT_PATHS: string[] = [
  // Generic credential field names (one level deep — the original Day 13 list)
  ...CREDENTIAL_FIELD_NAMES.map((name) => `*.${name}`),
  // Two levels deep: catches the `req.body.password`,
  // `response.body.access_token`, etc. shapes the Day 13 wildcards miss.
  ...NESTED_CREDENTIAL_CONTAINERS.flatMap((container) =>
    CREDENTIAL_FIELD_NAMES.map((name) => `${container}.${name}`),
  ),
  // OpenLander-specific shapes (top-level on the log object)
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
