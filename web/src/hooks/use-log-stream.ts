import { useState, useEffect, useRef, useCallback } from 'react';

import type { ConsoleFollowMode } from '@/types';

export interface LogEntry {
  id: number;
  line: string;
  stream: 'stdout' | 'stderr';
  time: string;
}

export type LogConnectionState = 'idle' | 'loading' | 'live' | 'disconnected' | 'error';

export interface LogStreamState {
  entries: LogEntry[];
  followMode: ConsoleFollowMode;
  connectionState: LogConnectionState;
  error: string | null;
  unseenCount: number;
  isLoadingOlder: boolean;
  canLoadOlder: boolean;
  historyLineCount: number;
}

interface UseLogStreamOptions {
  projectId: string | undefined;
  /** Optional service id. When set, the hook scopes the stream to that
   *  service's container instead of the project-level interleave —
   *  required for multi-service compose stacks where the project route
   *  picks a single service's container and shows only its output. */
  serviceId?: string;
  enabled?: boolean;
}

/**
 * Resolve the URL for a log read. Service-scoped reads fall back to the
 * project-level route when no serviceId is supplied so single-svc
 * projects keep their existing behaviour.
 */
function logUrl(projectId: string, serviceId: string | undefined, query: string): string {
  return serviceId
    ? `/api/projects/${projectId}/services/${serviceId}/logs${query}`
    : `/api/projects/${projectId}/logs${query}`;
}

interface UseLogStreamReturn extends LogStreamState {
  isConnected: boolean;
  isInitialLoading: boolean;
  isDisconnected: boolean;
  canJumpToLatest: boolean;
  clear: () => void;
  pauseFollowing: () => void;
  jumpToLatest: () => void;
  loadOlder: () => Promise<void>;
}

const DEFAULT_HISTORY_LINE_COUNT = 50;
const LOAD_OLDER_LINE_INCREMENT = 200;

let logIdCounter = 0;

function createLogEntry(
  line: string,
  stream: LogEntry['stream'] = 'stdout',
  time = new Date().toISOString(),
): LogEntry {
  logIdCounter += 1;
  return {
    id: logIdCounter,
    line,
    stream,
    time,
  };
}

function stripDockerStreamHeader(line: string): string {
  let nextLine = line;

  while (
    nextLine.length >= 8 &&
    nextLine.charCodeAt(0) >= 1 &&
    nextLine.charCodeAt(0) <= 3 &&
    nextLine.charCodeAt(1) === 0 &&
    nextLine.charCodeAt(2) === 0 &&
    nextLine.charCodeAt(3) === 0
  ) {
    nextLine = nextLine.slice(8);
  }

  return nextLine;
}

async function fetchLogSnapshot(
  projectId: string,
  serviceId: string | undefined,
  lineCount: number,
  signal: AbortSignal,
  envParam: string = '',
): Promise<LogEntry[]> {
  const res = await fetch(logUrl(projectId, serviceId, `?lines=${lineCount}${envParam}`), {
    signal,
  });
  if (!res.ok) {
    throw new Error(`Logs error: ${res.status}`);
  }

  const data = (await res.json()) as { logs?: unknown };
  const logs = typeof data.logs === 'string' ? data.logs : '';
  return parseStaticLogEntries(logs);
}

function compareEntries(left: LogEntry, right: LogEntry): boolean {
  return left.line === right.line && left.stream === right.stream;
}

function compareSnapshotEntry(left: LogEntry, right: LogEntry): boolean {
  return left.line === right.line;
}

function getTailOverlap<T>(
  current: T[],
  incoming: T[],
  compare: (left: T, right: T) => boolean,
): number {
  const maxOverlap = Math.min(current.length, incoming.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (!compare(current[current.length - overlap + index], incoming[index])) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return overlap;
    }
  }

  return 0;
}

export function parseStaticLogEntries(logs: string): LogEntry[] {
  return logs
    .split('\n')
    .map((line) => stripDockerStreamHeader(line))
    .filter((line) => line.trim().length > 0)
    .map((line) => createLogEntry(line));
}

export function createInitialLogStreamState(
  followMode: ConsoleFollowMode = 'follow',
): LogStreamState {
  return {
    entries: [],
    followMode,
    connectionState: 'idle',
    error: null,
    unseenCount: 0,
    isLoadingOlder: false,
    canLoadOlder: true,
    historyLineCount: DEFAULT_HISTORY_LINE_COUNT,
  };
}

export function appendStreamEntries(
  state: LogStreamState,
  incomingEntries: LogEntry[],
): LogStreamState {
  if (incomingEntries.length === 0) {
    return state;
  }

  const overlap = getTailOverlap(state.entries, incomingEntries, compareEntries);
  const appendedEntries = incomingEntries.slice(overlap);
  if (appendedEntries.length === 0) {
    return state;
  }

  return {
    ...state,
    entries: [...state.entries, ...appendedEntries],
    unseenCount:
      state.followMode === 'paused'
        ? state.unseenCount + appendedEntries.length
        : state.unseenCount,
  };
}

export function pauseLogStream(state: LogStreamState): LogStreamState {
  if (state.followMode === 'paused') {
    return state;
  }

  return {
    ...state,
    followMode: 'paused',
  };
}

export function jumpLogStreamToLatest(state: LogStreamState): LogStreamState {
  return {
    ...state,
    followMode: 'follow',
    unseenCount: 0,
  };
}

export function setLogConnectionState(
  state: LogStreamState,
  connectionState: LogConnectionState,
  error: string | null = state.error,
): LogStreamState {
  return {
    ...state,
    connectionState,
    error,
  };
}

export function shouldReconnectAfterStreamClose(
  state: Pick<LogStreamState, 'followMode'>,
  receivedLiveEntries: boolean,
  streamError: string | null,
): boolean {
  return state.followMode === 'follow' && receivedLiveEntries && streamError === null;
}

export function getConnectionStateAfterStreamClose(
  snapshotRefreshSucceeded: boolean,
  receivedLiveEntries: boolean,
  streamError: string | null,
): LogConnectionState {
  if (streamError === null && snapshotRefreshSucceeded && !receivedLiveEntries) {
    return 'idle';
  }

  return 'disconnected';
}

export function mergeOlderLogEntries(
  currentEntries: LogEntry[],
  snapshotEntries: LogEntry[],
): LogEntry[] {
  if (currentEntries.length === 0) {
    return snapshotEntries;
  }

  const overlap = getTailOverlap(snapshotEntries, currentEntries, compareSnapshotEntry);
  if (overlap === 0) {
    return [...snapshotEntries, ...currentEntries];
  }

  return [...snapshotEntries.slice(0, snapshotEntries.length - overlap), ...currentEntries];
}

export type ParsedStreamLine =
  | { type: 'entry'; entry: LogEntry }
  | { type: 'error'; error: string }
  | { type: 'ignore' };

/** Parse one NDJSON stream frame into an entry, stream error, or ignore marker. */
export function parseStreamLine(rawLine: string): ParsedStreamLine {
  const sanitizedRawLine = stripDockerStreamHeader(rawLine);

  if (!sanitizedRawLine.trim()) {
    return { type: 'ignore' };
  }

  try {
    const parsed = JSON.parse(sanitizedRawLine) as {
      error?: unknown;
      line?: unknown;
      stream?: unknown;
      time?: unknown;
    };

    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return { type: 'error', error: parsed.error };
    }

    const line = stripDockerStreamHeader(
      typeof parsed.line === 'string' ? parsed.line : sanitizedRawLine,
    );
    if (!line.trim()) {
      return { type: 'ignore' };
    }
    const stream = parsed.stream === 'stderr' ? 'stderr' : 'stdout';
    const time = typeof parsed.time === 'string' ? parsed.time : new Date().toISOString();
    return { type: 'entry', entry: createLogEntry(line, stream, time) };
  } catch {
    return { type: 'entry', entry: createLogEntry(sanitizedRawLine) };
  }
}

export function useLogStream({
  projectId,
  serviceId,
  enabled = true,
}: UseLogStreamOptions): UseLogStreamReturn {
  const [state, setState] = useState<LogStreamState>(() => createInitialLogStreamState());
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const connectStream = useCallback(async () => {
    if (!projectId || !enabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((current) => setLogConnectionState(current, 'loading', null));

    try {
      let snapshotRefreshSucceeded = false;

      try {
        const snapshotEntries = await fetchLogSnapshot(
          projectId,
          serviceId,
          DEFAULT_HISTORY_LINE_COUNT,
          controller.signal,
        );
        snapshotRefreshSucceeded = true;

        if (snapshotEntries.length > 0) {
          setState((current) => ({
            ...current,
            entries: mergeOlderLogEntries(current.entries, snapshotEntries),
            canLoadOlder: snapshotEntries.length >= DEFAULT_HISTORY_LINE_COUNT,
            historyLineCount: DEFAULT_HISTORY_LINE_COUNT,
          }));
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }
      }

      const res = await fetch(logUrl(projectId, serviceId, '?follow=true'), {
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`Stream error: ${res.status}`);
      if (!res.body) throw new Error('No response body');

      setState((current) => setLogConnectionState(current, 'live', null));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedLiveEntries = false;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        const newEntries: LogEntry[] = [];
        let nextError: string | null = null;

        for (const rawLine of lines) {
          const parsedLine = parseStreamLine(rawLine);
          if (parsedLine.type === 'entry') {
            newEntries.push(parsedLine.entry);
          }
          if (parsedLine.type === 'error') {
            nextError = parsedLine.error;
            streamError = parsedLine.error;
          }
        }

        if (newEntries.length > 0 || nextError) {
          if (newEntries.length > 0) {
            receivedLiveEntries = true;
          }
          setState((current) => {
            const withEntries = appendStreamEntries(current, newEntries);
            return nextError ? { ...withEntries, error: nextError } : withEntries;
          });
        }
      }

      if (shouldReconnectAfterStreamClose(stateRef.current, receivedLiveEntries, streamError)) {
        void connectStream();
        return;
      }

      setState((current) =>
        setLogConnectionState(
          current,
          getConnectionStateAfterStreamClose(
            snapshotRefreshSucceeded,
            receivedLiveEntries,
            streamError,
          ),
          current.error,
        ),
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      const message = err instanceof Error ? err.message : 'Stream failed';
      setState((current) => setLogConnectionState(current, 'error', message));
    }
  }, [enabled, projectId, serviceId]);

  useEffect(() => {
    abortRef.current?.abort();

    if (!enabled || !projectId) {
      setState(createInitialLogStreamState());
      return undefined;
    }

    setState(createInitialLogStreamState());
    void connectStream();

    return () => {
      abortRef.current?.abort();
    };
  }, [connectStream, enabled, projectId, serviceId]);

  const clear = useCallback(() => {
    setState((current) => ({
      ...current,
      entries: [],
      unseenCount: 0,
      canLoadOlder: true,
      historyLineCount: DEFAULT_HISTORY_LINE_COUNT,
    }));
  }, []);

  const pauseFollowing = useCallback(() => {
    setState((current) => pauseLogStream(current));
  }, []);

  const jumpToLatest = useCallback(() => {
    const currentState = stateRef.current;
    setState((current) => jumpLogStreamToLatest(current));

    if (
      currentState.connectionState === 'disconnected' ||
      currentState.connectionState === 'error'
    ) {
      void connectStream();
    }
  }, [connectStream]);

  const loadOlder = useCallback(async () => {
    if (!projectId) return;

    const currentState = stateRef.current;
    if (currentState.isLoadingOlder) return;

    const nextLineCount = currentState.historyLineCount + LOAD_OLDER_LINE_INCREMENT;
    setState((current) => ({ ...current, isLoadingOlder: true }));

    try {
      const res = await fetch(logUrl(projectId, serviceId, `?lines=${nextLineCount}`));
      if (!res.ok) throw new Error(`Logs error: ${res.status}`);

      const data = (await res.json()) as { logs?: unknown };
      const logs = typeof data.logs === 'string' ? data.logs : '';
      const snapshotEntries = parseStaticLogEntries(logs);

      setState((current) => ({
        ...current,
        entries: mergeOlderLogEntries(current.entries, snapshotEntries),
        isLoadingOlder: false,
        canLoadOlder: snapshotEntries.length >= nextLineCount,
        historyLineCount: nextLineCount,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load older logs';
      setState((current) => ({
        ...current,
        error: message,
        isLoadingOlder: false,
      }));
    }
  }, [projectId, serviceId]);

  return {
    ...state,
    isConnected: state.connectionState === 'live',
    isInitialLoading: state.connectionState === 'loading' && state.entries.length === 0,
    isDisconnected: state.connectionState === 'disconnected',
    canJumpToLatest: state.followMode === 'paused' || state.unseenCount > 0,
    clear,
    pauseFollowing,
    jumpToLatest,
    loadOlder,
  };
}
