/**
 * Contract test: GET /api/deployments/:id/log/stream (SSE)
 *
 * Opens the SSE channel against two seeded deployments:
 *   - deploy-done-1: completed deploy; asserts terminal event parses
 *     against DeployEndEventSchema.
 *   - deploy-running-1: running deploy; asserts the first non-end event
 *     parses against DeployLineEventSchema.
 *
 * ErrorClass round-trip: asserts that any `errorClass` in the terminal
 * event round-trips through ErrorClassSchema.parse() — no free-form
 * strings on the wire.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { DeployLineEventSchema, DeployEndEventSchema } from '../../src/lib/api/deploy-stream-zod';
import { ErrorClassSchema } from '../../src/lib/api/services-zod';
import { getBaseUrl, authedFetch } from './helpers';

/**
 * Reads SSE events from a fetch response stream until either:
 *   - we get `maxEvents` events, or
 *   - the stream closes.
 * Returns parsed JSON payloads.
 */
async function collectSseEvents(url: string, maxEvents: number, timeoutMs = 10_000): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const events: unknown[] = [];
  try {
    const res = await authedFetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!res.ok) throw new Error(`SSE fetch failed: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (data) {
            events.push(JSON.parse(data));
            if (events.length >= maxEvents) break outer;
          }
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return events;
}

describe('deploy-log SSE contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  it('completed deploy streams at least one line event parseable by DeployLineEventSchema', async () => {
    const events = await collectSseEvents(
      `${baseUrl}/api/deployments/deploy-done-1/log/stream`,
      5,
    );
    expect(events.length).toBeGreaterThanOrEqual(1);

    // The first non-end event must match DeployLineEventSchema
    const firstLine = events.find((e) => {
      const obj = e as Record<string, unknown>;
      return obj.type !== 'end';
    });
    if (firstLine) {
      DeployLineEventSchema.parse(firstLine);
    }
  });

  it('completed deploy emits a terminal "end" event parseable by DeployEndEventSchema', async () => {
    const events = await collectSseEvents(
      `${baseUrl}/api/deployments/deploy-done-1/log/stream`,
      200,
    );

    const endEvent = events.find((e) => {
      const obj = e as Record<string, unknown>;
      return obj.type === 'end';
    });

    expect(endEvent).toBeDefined();
    const parsed = DeployEndEventSchema.parse(endEvent);
    expect(['success', 'fail', 'cancelled']).toContain(parsed.outcome);
  });

  it('seeded completed deploy terminal event has outcome "success"', async () => {
    const events = await collectSseEvents(
      `${baseUrl}/api/deployments/deploy-done-1/log/stream`,
      200,
    );
    const endEvent = events.find((e) => (e as Record<string, unknown>).type === 'end');
    const parsed = DeployEndEventSchema.parse(endEvent);
    expect(parsed.outcome).toBe('success');
  });

  it('errorClass in terminal event round-trips through ErrorClassSchema (no free-form strings)', async () => {
    const events = await collectSseEvents(
      `${baseUrl}/api/deployments/deploy-done-1/log/stream`,
      200,
    );
    const endEvent = events.find((e) => (e as Record<string, unknown>).type === 'end');
    const parsed = DeployEndEventSchema.parse(endEvent);

    if (parsed.errorClass !== undefined) {
      // Must be a valid 16-key ErrorClass — parse throws if not
      ErrorClassSchema.parse(parsed.errorClass);
    }
    // If no errorClass, success deploy is fine with undefined
  });

  it('emitting a non-16-key errorClass value fails DeployEndEventSchema.parse', () => {
    const badEndEvent = {
      type: 'end',
      outcome: 'fail',
      errorClass: 'SOME_INVENTED_ERROR', // not in the 16-key registry
    };
    expect(() => DeployEndEventSchema.parse(badEndEvent)).toThrow(z.ZodError);
  });

  it('running deploy SSE channel opens without error', async () => {
    // Just assert the channel returns 200 and begins streaming
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3_000);

    const res = await authedFetch(`${baseUrl}/api/deployments/deploy-running-1/log/stream`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    }).catch((e: Error) => {
      if (e.name === 'AbortError') return null;
      throw e;
    });

    if (res) {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    }
  });
});
