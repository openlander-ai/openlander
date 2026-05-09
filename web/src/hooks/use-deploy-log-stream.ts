/**
 * SSE-backed deploy log stream hook — Round 4 PR6.
 *
 * Subscribes to `/api/deployments/:id/log/stream` and produces the same
 * shape as the in-component setTimeout simulator the LogViewer used to
 * carry. Each SSE `data:` event is JSON of the form:
 *
 *   { phase, prefix, payload }
 *
 * The terminal event is:
 *
 *   { type: 'end', outcome: 'success' | 'fail' | 'cancelled', errorClass? }
 *
 * Progress markers: the in-process mock simulator drives the inline
 * progress bar with synthetic `{progress}` entries. The real backend
 * never emits that marker — it streams plain log lines. PR7 dropped
 * the dead branch that watched for `{progress}` here so the SSE path
 * stays focused on the actual server contract. If the backend ever
 * adds discrete progress events we'll plumb them as a NEW message type
 * rather than re-introducing the synthetic marker.
 *
 * Reconnect (per Codex CCG review): EventSource auto-reconnects, but
 * `firstLineSeen` is single-shot so we'd stay stuck in RECONNECTING
 * forever after the first transport blip. Fix: flip to LIVE on ANY
 * message received while we're not in a terminal state.
 *
 * Generation guard (per Codex CCG review): `deploymentId` swaps must
 * not let the old EventSource's callbacks mutate the new stream's
 * state. We track a per-mount `sessionIdRef`; each `onmessage`
 * captures it and bails if it doesn't match. Handlers are also nulled
 * in cleanup so a fired-but-not-yet-dispatched event is dropped.
 *
 * Disabled: when `deploymentId` is null we no-op (no EventSource is
 * opened). LogViewer uses this to keep both stream hooks mounted and
 * pick whichever one matches `mockMode` + `deploymentId`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry } from '../lib/logScripts';
import type { ConnState } from '../components/Shell/LogViewerHeader';

interface SseLineEvent {
  type?: undefined;
  phase: LogEntry['phase'];
  prefix: LogEntry['prefix'];
  payload: string;
}

interface SseEndEvent {
  type: 'end';
  outcome: 'success' | 'fail' | 'cancelled';
  errorClass?: string;
}

type SsePayload = SseLineEvent | SseEndEvent;

export interface UseDeployLogStreamResult {
  lines: LogEntry[];
  /**
   * Always empty for SSE today — the backend doesn't emit synthetic
   * progress markers (those are mock-only). Kept on the public shape
   * so LogViewer can blindly consume either stream hook without a
   * conditional. If real progress events ship later they'll populate
   * this map.
   */
  progressByLineNum: Record<number, number>;
  connState: ConnState;
  buildOutcome: 'success' | 'fail' | null;
  errorClass: string | undefined;
  /** Most recent SSE `id:` value, for future Last-Event-ID resume. */
  lastEventId: string | null;
  getElapsedSec: () => number;
  kill: () => void;
}

function isTerminal(state: ConnState): boolean {
  return state === 'ENDED' || state === 'CANCELLED' || state === 'ERRORED';
}

/** Stable empty object so consumers can `useMemo` against the same ref. */
const EMPTY_PROGRESS: Record<number, number> = Object.freeze({}) as Record<number, number>;

export function useDeployLogStream(deploymentId: string | number | null): UseDeployLogStreamResult {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [connState, setConnState] = useState<ConnState>('CONNECTING');
  const [buildOutcome, setBuildOutcome] = useState<'success' | 'fail' | null>(null);
  const [errorClass, setErrorClass] = useState<string | undefined>(undefined);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  // SSE doesn't emit synthetic progress markers — see file header.
  const progressByLineNum: Record<number, number> = EMPTY_PROGRESS;

  const sourceRef = useRef<EventSource | null>(null);
  const sessionRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const elapsedFrozenRef = useRef<number | null>(null);

  useEffect(() => {
    if (deploymentId == null) {
      // Disabled — leave any prior state as-is. The consumer (LogViewer)
      // only reads the OTHER stream when this one is dormant, so stale
      // state is invisible. Resetting here would be a setState-in-effect
      // anti-pattern with no payoff.
      startedAtRef.current = 0;
      elapsedFrozenRef.current = null;
      return undefined;
    }

    // Reset state on deploymentId change. The set-state-in-effect rule
    // flags this pattern, but it's the documented React 19 escape hatch
    // when forcing a remount via `key=` would invalidate sibling state
    // (LogViewer's viewState, virtualizer scroll, etc.). Each reset is
    // immediately followed by `new EventSource(url)` — the external
    // sync the rule wants to see.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLines([]);
    setConnState('CONNECTING');
    setBuildOutcome(null);
    setErrorClass(undefined);
    setLastEventId(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    startedAtRef.current = Date.now();
    elapsedFrozenRef.current = null;

    sessionRef.current += 1;
    const session = sessionRef.current;

    const url = `/api/deployments/${encodeURIComponent(String(deploymentId))}/log/stream`;
    const es = new EventSource(url);
    sourceRef.current = es;

    const handleLastEventId = (ev: MessageEvent<string>) => {
      if (ev.lastEventId) setLastEventId(ev.lastEventId);
    };

    const handleLinePayload = (payload: SseLineEvent) => {
      // Any non-terminal data event proves the stream is alive — flip out
      // of CONNECTING/RECONNECTING regardless of whether this is the very
      // first line we've seen on this session.
      setConnState((cur) => (isTerminal(cur) ? cur : 'LIVE'));

      const entry: LogEntry = {
        phase: payload.phase,
        prefix: payload.prefix,
        payload: payload.payload,
      };

      setLines((prev) => [...prev, entry]);
    };

    const handleEndPayload = (payload: SseEndEvent) => {
      elapsedFrozenRef.current = (Date.now() - startedAtRef.current) / 1000;
      if (payload.outcome === 'cancelled') {
        setConnState('CANCELLED');
      } else {
        setConnState('ENDED');
        setBuildOutcome(payload.outcome === 'fail' ? 'fail' : 'success');
        if (payload.errorClass) setErrorClass(payload.errorClass);
      }
      es.close();
      sourceRef.current = null;
    };

    const onLineEvent = (ev: MessageEvent<string>) => {
      if (session !== sessionRef.current) return; // stale callback after deploymentId swap
      handleLastEventId(ev);

      let payload: SseLineEvent;
      try {
        payload = JSON.parse(ev.data) as SseLineEvent;
      } catch {
        return;
      }
      handleLinePayload(payload);
    };

    const onEndEvent = (ev: MessageEvent<string>) => {
      if (session !== sessionRef.current) return;

      let payload: SseEndEvent;
      try {
        payload = JSON.parse(ev.data) as SseEndEvent;
      } catch {
        return;
      }
      handleEndPayload(payload);
    };

    const onMessage = (ev: MessageEvent<string>) => {
      if (session !== sessionRef.current) return;
      handleLastEventId(ev);

      let payload: SsePayload;
      try {
        payload = JSON.parse(ev.data) as SsePayload;
      } catch {
        return;
      }

      if (payload.type === 'end') {
        handleEndPayload(payload);
      } else {
        handleLinePayload(payload);
      }
    };

    const onError = () => {
      if (session !== sessionRef.current) return;
      // EventSource auto-reconnects unless it's CLOSED. Surface the dip.
      if (es.readyState === EventSource.CLOSED) {
        setConnState((cur) => (isTerminal(cur) ? cur : 'ERRORED'));
      } else {
        setConnState((cur) => (isTerminal(cur) || cur === 'CONNECTING' ? cur : 'RECONNECTING'));
      }
    };

    // The backend sends named SSE events (`event: line` / `event: end`).
    // `onmessage` only receives default `message` events, so listen to both
    // named events and keep `onmessage` as a compatibility fallback.
    es.addEventListener('line', onLineEvent);
    es.addEventListener('end', onEndEvent);
    es.onmessage = onMessage;
    es.onerror = onError;

    return () => {
      // Null handlers FIRST so any in-flight dispatch is dropped. Then
      // close so future reconnects don't run with stale closures.
      es.removeEventListener('line', onLineEvent);
      es.removeEventListener('end', onEndEvent);
      es.onmessage = null;
      es.onerror = null;
      es.close();
      if (sourceRef.current === es) sourceRef.current = null;
    };
  }, [deploymentId]);

  const getElapsedSec = useCallback(() => {
    if (startedAtRef.current === 0) return 0;
    if (elapsedFrozenRef.current != null) return elapsedFrozenRef.current;
    return (Date.now() - startedAtRef.current) / 1000;
  }, []);

  const kill = useCallback(() => {
    elapsedFrozenRef.current = (Date.now() - startedAtRef.current) / 1000;
    const es = sourceRef.current;
    if (es) {
      es.onmessage = null;
      es.onerror = null;
      es.close();
      sourceRef.current = null;
    }
    setConnState('CANCELLED');
  }, []);

  // PR8: stabilize return identity so consumers' `useMemo`/`useCallback`
  // dependency arrays don't thrash on every render. Without this, any
  // downstream `[stream]` dep recomputes per render even when none of the
  // underlying state slices changed. `getElapsedSec`/`kill` are already
  // stable via `useCallback`, and `progressByLineNum` is a frozen
  // singleton, so the only true churn sources are the state slices.
  return useMemo(
    () => ({
      lines,
      progressByLineNum,
      connState,
      buildOutcome,
      errorClass,
      lastEventId,
      getElapsedSec,
      kill,
    }),
    [
      lines,
      progressByLineNum,
      connState,
      buildOutcome,
      errorClass,
      lastEventId,
      getElapsedSec,
      kill,
    ],
  );
}
