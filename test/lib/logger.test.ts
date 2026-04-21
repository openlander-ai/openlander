/**
 * Day 13 hardening: Pino redact paths must scrub credentials before they
 * reach stdout / the in-memory log buffer / the log-stream WebSocket.
 *
 * The production logger silences output under NODE_ENV=test, so we cannot
 * just call `log.info()` and inspect the buffer. Instead we use a fresh
 * pino instance with the same redact list and a writable sink — that's the
 * smallest unit that proves the field-name list catches the shapes the
 * rest of the codebase tends to log.
 *
 * The list must stay in sync with `REDACT_PATHS` in src/lib/logger.ts.
 */
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';

const REDACT_PATHS: string[] = [
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
  'setupSecret',
  'apiToken',
  'oauth_code',
  'oauthCode',
  'verifier',
  'pkce_verifier',
  'pkceVerifier',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

interface CaptureSink {
  records: Record<string, unknown>[];
  writable: Writable;
}

function makeSink(): CaptureSink {
  const records: Record<string, unknown>[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          /* skip non-JSON noise */
        }
      }
      cb();
    },
  });
  return { records, writable };
}

function makeLogger(sink: CaptureSink): pino.Logger {
  return pino(
    {
      level: 'info',
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    sink.writable,
  );
}

describe('Day 13 hardening: logger PII redaction', () => {
  it('redacts password / token / secret on a generic user object', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    log.info(
      { user: { id: 'u1', password: 'hunter2', token: 'tok-abc', secret: 's3cr3t' } },
      'login',
    );
    const record = sink.records[0];
    expect(record).toBeDefined();
    const user = (record as { user: Record<string, string> }).user;
    expect(user.password).toBe('[REDACTED]');
    expect(user.token).toBe('[REDACTED]');
    expect(user.secret).toBe('[REDACTED]');
    expect(user.id).toBe('u1');
  });

  it('redacts OAuth credential field names (camelCase + snake_case)', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    log.info(
      {
        body: {
          access_token: 'tok-1',
          accessToken: 'tok-2',
          refresh_token: 'tok-3',
          refreshToken: 'tok-4',
          client_secret: 's-1',
          clientSecret: 's-2',
        },
      },
      'oauth callback',
    );
    const body = (sink.records[0] as { body: Record<string, string> }).body;
    expect(body.access_token).toBe('[REDACTED]');
    expect(body.accessToken).toBe('[REDACTED]');
    expect(body.refresh_token).toBe('[REDACTED]');
    expect(body.refreshToken).toBe('[REDACTED]');
    expect(body.client_secret).toBe('[REDACTED]');
    expect(body.clientSecret).toBe('[REDACTED]');
  });

  it('redacts OpenLander-specific shapes (setupSecret, apiToken, oauth_code)', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    log.info(
      {
        setupSecret: 'one-time-setup-secret-do-not-leak',
        apiToken: 'api-tok-deadbeef',
        oauth_code: 'auth-code-abc',
        oauthCode: 'auth-code-xyz',
        verifier: 'pkce-verifier-string',
      },
      'setup',
    );
    const record = sink.records[0] as Record<string, string>;
    expect(record.setupSecret).toBe('[REDACTED]');
    expect(record.apiToken).toBe('[REDACTED]');
    expect(record.oauth_code).toBe('[REDACTED]');
    expect(record.oauthCode).toBe('[REDACTED]');
    expect(record.verifier).toBe('[REDACTED]');
  });

  it('redacts HTTP request authorization and cookie headers', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    log.info(
      {
        req: {
          method: 'POST',
          path: '/api/foo',
          headers: {
            authorization: 'Bearer leaky-token-here',
            cookie: 'ol_session=this-should-not-leak',
            'user-agent': 'curl/8.0.0',
          },
        },
      },
      'incoming request',
    );
    const headers = (sink.records[0] as { req: { headers: Record<string, string> } }).req.headers;
    expect(headers.authorization).toBe('[REDACTED]');
    expect(headers.cookie).toBe('[REDACTED]');
    // Non-sensitive headers must pass through unchanged.
    expect(headers['user-agent']).toBe('curl/8.0.0');
  });

  it('preserves non-sensitive fields verbatim so logs remain useful', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    log.info(
      { project: { id: 'p1', name: 'demo', port: 10001 }, action: 'deploy' },
      'project deployed',
    );
    const record = sink.records[0] as Record<string, unknown>;
    const project = record.project as Record<string, unknown>;
    expect(project.id).toBe('p1');
    expect(project.name).toBe('demo');
    expect(project.port).toBe(10001);
    expect(record.action).toBe('deploy');
  });

  it('does not crash when the credential-bearing field is missing', () => {
    const sink = makeSink();
    const log = makeLogger(sink);
    expect(() => log.info({ user: { id: 'u1' } }, 'no creds')).not.toThrow();
    const user = (sink.records[0] as { user: Record<string, unknown> }).user;
    expect(user.id).toBe('u1');
  });
});
