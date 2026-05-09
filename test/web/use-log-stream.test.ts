import { describe, expect, it } from 'vitest';

import {
  appendStreamEntries,
  createInitialLogStreamState,
  getConnectionStateAfterStreamClose,
  jumpLogStreamToLatest,
  mergeOlderLogEntries,
  parseStreamLine,
  parseStaticLogEntries,
  pauseLogStream,
  setLogConnectionState,
  shouldReconnectAfterStreamClose,
} from '../../web/src/hooks/use-log-stream';

describe('useLogStream state helpers', () => {
  it('starts in follow mode with explicit idle state', () => {
    expect(createInitialLogStreamState()).toEqual({
      entries: [],
      followMode: 'follow',
      connectionState: 'idle',
      error: null,
      unseenCount: 0,
      isLoadingOlder: false,
      canLoadOlder: true,
      historyLineCount: 50,
    });
  });

  it('pauses follow mode and accumulates unseen lines until jumping back to latest', () => {
    const pausedState = pauseLogStream(
      setLogConnectionState(createInitialLogStreamState(), 'live', null),
    );
    const withIncoming = appendStreamEntries(pausedState, parseStaticLogEntries('third\nfourth'));

    expect(withIncoming.followMode).toBe('paused');
    expect(withIncoming.entries.map((entry) => entry.line)).toEqual(['third', 'fourth']);
    expect(withIncoming.unseenCount).toBe(2);

    const resumed = jumpLogStreamToLatest(withIncoming);
    expect(resumed.followMode).toBe('follow');
    expect(resumed.unseenCount).toBe(0);
  });

  it('keeps follow mode live updates visible without growing unseen count', () => {
    const liveState = setLogConnectionState(createInitialLogStreamState(), 'live', null);
    const withIncoming = appendStreamEntries(liveState, parseStaticLogEntries('alpha\nbeta'));

    expect(withIncoming.followMode).toBe('follow');
    expect(withIncoming.entries.map((entry) => entry.line)).toEqual(['alpha', 'beta']);
    expect(withIncoming.unseenCount).toBe(0);
  });

  it('keeps disconnect and recovery transitions explicit', () => {
    const liveState = setLogConnectionState(createInitialLogStreamState(), 'live', null);
    const disconnected = setLogConnectionState(liveState, 'disconnected', null);
    const reconnecting = setLogConnectionState(disconnected, 'loading', null);
    const recovered = setLogConnectionState(reconnecting, 'live', null);

    expect(disconnected.connectionState).toBe('disconnected');
    expect(reconnecting.connectionState).toBe('loading');
    expect(reconnecting.error).toBeNull();
    expect(recovered.connectionState).toBe('live');
  });

  it('auto-reconnects after a follow stream closes only when fresh lines arrived cleanly', () => {
    const followState = createInitialLogStreamState();
    const pausedState = pauseLogStream(followState);

    expect(shouldReconnectAfterStreamClose(followState, true, null)).toBe(true);
    expect(shouldReconnectAfterStreamClose(followState, false, null)).toBe(false);
    expect(shouldReconnectAfterStreamClose(followState, true, 'connection lost')).toBe(false);
    expect(shouldReconnectAfterStreamClose(pausedState, true, null)).toBe(false);
  });

  it('settles quiet successful refreshes into an idle state instead of disconnected', () => {
    expect(getConnectionStateAfterStreamClose(true, false, null)).toBe('idle');
    expect(getConnectionStateAfterStreamClose(false, false, null)).toBe('disconnected');
    expect(getConnectionStateAfterStreamClose(true, true, null)).toBe('disconnected');
    expect(getConnectionStateAfterStreamClose(true, false, 'connection lost')).toBe('disconnected');
  });

  it('keeps stream errors attached until an explicit reconnect clears them', () => {
    const failed = setLogConnectionState(
      createInitialLogStreamState(),
      'error',
      'Stream error: 503',
    );
    const disconnected = setLogConnectionState(failed, 'disconnected', failed.error);
    const reconnecting = setLogConnectionState(disconnected, 'loading', null);

    expect(failed.error).toBe('Stream error: 503');
    expect(disconnected.error).toBe('Stream error: 503');
    expect(reconnecting.error).toBeNull();
  });

  it('loads older logs by prepending only missing snapshot lines', () => {
    const currentEntries = parseStaticLogEntries('gamma\ndelta\nepsilon');
    const snapshotEntries = parseStaticLogEntries('alpha\nbeta\ngamma\ndelta\nepsilon');

    const merged = mergeOlderLogEntries(currentEntries, snapshotEntries);
    expect(merged.map((entry) => entry.line)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
    ]);
  });

  it('deduplicates reconnect tails before appending new live lines', () => {
    const baseState = {
      ...createInitialLogStreamState(),
      entries: parseStaticLogEntries('one\ntwo\nthree'),
    };

    const merged = appendStreamEntries(baseState, parseStaticLogEntries('two\nthree\nfour'));
    expect(merged.entries.map((entry) => entry.line)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('keeps older snapshot merges stable when the live tail has no overlap', () => {
    const currentEntries = parseStaticLogEntries('delta\nepsilon');
    const snapshotEntries = parseStaticLogEntries('alpha\nbeta\ngamma');

    const merged = mergeOlderLogEntries(currentEntries, snapshotEntries);
    expect(merged.map((entry) => entry.line)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
    ]);
  });

  it('ignores blank stream frames and surfaces explicit stream errors', () => {
    expect(parseStreamLine('   ')).toEqual({ type: 'ignore' });
    expect(parseStreamLine('{"error":"connection lost"}')).toEqual({
      type: 'error',
      error: 'connection lost',
    });
  });

  it('degrades malformed stream payloads into safe stdout entries', () => {
    expect(parseStreamLine('{"line":"stderr ok","stream":"stderr"}')).toMatchObject({
      type: 'entry',
      entry: {
        line: 'stderr ok',
        stream: 'stderr',
        time: expect.any(String),
      },
    });

    expect(parseStreamLine('{"line":42')).toMatchObject({
      type: 'entry',
      entry: {
        line: '{"line":42',
        stream: 'stdout',
        time: expect.any(String),
      },
    });

    expect(parseStreamLine('{"line":42,"stream":"stderr"}')).toMatchObject({
      type: 'entry',
      entry: {
        line: '{"line":42,"stream":"stderr"}',
        stream: 'stderr',
        time: expect.any(String),
      },
    });
  });

  it('strips Docker stdcopy headers from snapshot lines before rendering', () => {
    const entries = parseStaticLogEntries(
      '\u0001\u0000\u0000\u0000\u0000\u0000\u0000V127.0.0.1 - - [11/Mar/2026:04:44:45 +0000] "GET / HTTP/1.1" 200\nplain line',
    );

    expect(entries.map((entry) => entry.line)).toEqual([
      '127.0.0.1 - - [11/Mar/2026:04:44:45 +0000] "GET / HTTP/1.1" 200',
      'plain line',
    ]);
  });

  it('uses Docker timestamps from snapshot log lines', () => {
    const entries = parseStaticLogEntries(
      '2026-05-08T22:17:23.351234567Z container started\n2026-05-08T22:17:24Z ready',
    );

    expect(entries.map((entry) => entry.line)).toEqual(['container started', 'ready']);
    expect(entries.map((entry) => entry.time)).toEqual([
      '2026-05-08T22:17:23.351Z',
      '2026-05-08T22:17:24.000Z',
    ]);
  });

  it('strips Docker stdcopy headers from live frames and embedded JSON lines', () => {
    const jsonFrame = JSON.stringify({
      line: '\u0001\u0000\u0000\u0000\u0000\u0000\u0000Wstderr payload',
      stream: 'stderr',
    });

    expect(
      parseStreamLine(
        '\u0001\u0000\u0000\u0000\u0000\u0000\u0000\\172.18.0.1 - - [11/Mar/2026:04:45:35 +0000] "GET / HTTP/1.1" 200',
      ),
    ).toMatchObject({
      type: 'entry',
      entry: {
        line: '172.18.0.1 - - [11/Mar/2026:04:45:35 +0000] "GET / HTTP/1.1" 200',
        stream: 'stdout',
        time: expect.any(String),
      },
    });

    expect(parseStreamLine(jsonFrame)).toMatchObject({
      type: 'entry',
      entry: {
        line: 'stderr payload',
        stream: 'stderr',
        time: expect.any(String),
      },
    });
  });

  it('uses Docker timestamps from live JSON payloads when the backend includes them', () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          line: '2026-05-08T22:17:23.351234567Z live payload',
          stream: 'stderr',
        }),
      ),
    ).toMatchObject({
      type: 'entry',
      entry: {
        line: 'live payload',
        stream: 'stderr',
        time: '2026-05-08T22:17:23.351Z',
      },
    });
  });
});
