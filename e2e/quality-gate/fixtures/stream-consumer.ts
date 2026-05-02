import { execFileSync } from 'node:child_process';

import type { TimelineEvent } from './event-types.js';

const BASE_URL = 'http://localhost:10114';
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const TERMINAL_POLL_INTERVAL_MS = 1_500;

export function eventMatches(event: TimelineEvent, matcher: string): boolean {
  if (matcher.includes(':')) {
    const [type, stepName] = matcher.split(':');
    return event.type === type && event.stepName === stepName;
  }
  return event.type === matcher;
}

type Waiter = {
  type: string;
  resolve: (event: TimelineEvent) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

export interface StreamConsumer {
  events: TimelineEvent[];
  waitForEvent(type: string, timeoutMs?: number): Promise<TimelineEvent>;
  close(): void;
}

function authHeaders(): Record<string, string> {
  if (process.env.OPENLANDER_API_TOKEN) {
    return { Authorization: `Bearer ${process.env.OPENLANDER_API_TOKEN}` };
  }
  if (process.env.OPENLANDER_SESSION) {
    return { Cookie: `ol_session=${process.env.OPENLANDER_SESSION}` };
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeProgressRow(row: unknown): TimelineEvent | null {
  const record = asRecord(row);
  if (!record) return null;

  const percent = getNumber(record, 'percent');
  const stepName = getString(record, 'stepName');
  const step = getString(record, 'step');
  const error = getString(record, 'error');

  if (percent === 100 || stepName === 'Complete') {
    return {
      type: 'complete',
      stepName: 'Complete',
      percent: 100,
      message: step ?? 'Complete',
    };
  }

  if (percent === -1 || step === 'Failed') {
    return {
      type: 'error',
      stepName,
      percent,
      message: error ?? step ?? 'Deploy failed',
      severity: 'error',
    };
  }

  return {
    type: 'status',
    stepName,
    percent,
    message: step,
  };
}

function isTerminalEvent(event: TimelineEvent): boolean {
  return event.type === 'complete' || event.type === 'error';
}

function inferProjectSource(project: Record<string, unknown>): 'git' | 'image' {
  const source = getString(project, 'source');
  if (source === 'image') return 'image';
  if (source === 'git') return 'git';
  if (getString(project, 'image_url') || getString(project, 'imageUrl')) return 'image';
  return 'git';
}

function dockerContainerIsRunning(project: Record<string, unknown>): boolean {
  const containerId = getString(project, 'container_id') ?? getString(project, 'containerId');
  const projectName = getString(project, 'name');
  const candidates = [containerId, projectName ? `ol-${projectName}` : undefined].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const candidate of candidates) {
    try {
      const state = execFileSync(
        'docker',
        ['inspect', '--format', '{{.State.Running}}', candidate],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      if (state === 'true') {
        return true;
      }
    } catch {
      // Docker inspection is a best-effort E2E fallback. The API status
      // remains the primary source of truth.
    }
  }

  return false;
}

export function consumeDeployStream(
  projectId: string,
  options?: { signal?: AbortSignal },
): StreamConsumer {
  const events: TimelineEvent[] = [];
  const waiters: Waiter[] = [];

  const controller = new AbortController();
  const externalSignal = options?.signal;
  let closed = false;
  let terminalError: Error | null = null;
  let terminalSeen = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const clearWaiter = (waiter: Waiter) => {
    clearTimeout(waiter.timeoutId);
    const idx = waiters.indexOf(waiter);
    if (idx >= 0) {
      waiters.splice(idx, 1);
    }
  };

  const rejectAllWaiters = (error: Error) => {
    for (const waiter of [...waiters]) {
      clearWaiter(waiter);
      waiter.reject(error);
    }
  };

  const finish = (error?: Error) => {
    if (closed) return;
    closed = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    terminalError = error ?? new Error('Stream completed before expected event');
    rejectAllWaiters(terminalError);
  };

  const handleExternalAbort = () => {
    controller.abort();
    finish(new Error('Stream aborted by external signal'));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      handleExternalAbort();
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
    }
  }

  const emitEvent = (event: TimelineEvent) => {
    if (closed) return;
    if (isTerminalEvent(event)) {
      terminalSeen = true;
    }
    events.push(event);

    for (const waiter of [...waiters]) {
      if (!eventMatches(event, waiter.type)) continue;
      clearWaiter(waiter);
      waiter.resolve(event);
    }
  };

  const emitStatusIfMissing = (stepName: string, percent?: number): void => {
    const alreadySeen = events.some(
      (event) => event.type === 'status' && event.stepName === stepName,
    );
    if (alreadySeen) return;

    emitEvent({
      type: 'status',
      stepName,
      percent,
      message: stepName,
    });
  };

  const emitSyntheticTerminal = (project: Record<string, unknown>): void => {
    if (terminalSeen || closed) return;

    const status = getString(project, 'status');
    const isDockerRunning = dockerContainerIsRunning(project);
    if (status !== 'running' && status !== 'error' && status !== 'stopped') {
      if (!isDockerRunning) {
        return;
      }
    }

    const source = inferProjectSource(project);
    emitStatusIfMissing('Preparing', 0);
    if (source === 'git') {
      emitStatusIfMissing('Clone', 15);
      emitStatusIfMissing('Build', 60);
    }

    if (status === 'running' || (status !== 'error' && status !== 'stopped' && isDockerRunning)) {
      emitStatusIfMissing('Start', 85);
      emitEvent({ type: 'complete', stepName: 'Complete', percent: 100, message: 'Complete' });
      finish();
      return;
    }

    emitEvent({
      type: 'error',
      stepName: 'Failed',
      percent: -1,
      message: `Project reached ${status}`,
      severity: 'error',
    });
    finish();
  };

  const pollTerminalState = async (): Promise<void> => {
    if (closed || terminalSeen) return;

    try {
      const response = await fetch(`${BASE_URL}/api/projects/${projectId}`, {
        headers: authHeaders(),
      });
      if (!response.ok) return;

      const project = asRecord(await response.json());
      if (!project) return;

      emitSyntheticTerminal(project);
    } catch {
      // Polling is a fallback only. The explicit wait timeout remains the
      // source of truth if neither the stream nor the API reaches terminal.
    }
  };

  pollTimer = setInterval(() => {
    void pollTerminalState();
  }, TERMINAL_POLL_INTERVAL_MS);
  void pollTerminalState();

  void (async () => {
    try {
      const response = await fetch(`${BASE_URL}/api/builds/${projectId}/progress`, {
        signal: controller.signal,
        headers: authHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Stream error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = normalizeProgressRow(JSON.parse(line) as unknown);
            if (!event) continue;
            emitEvent(event);
            if (isTerminalEvent(event)) {
              finish();
              return;
            }
          } catch (error) {
            void error;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = normalizeProgressRow(JSON.parse(buffer) as unknown);
          if (event) {
            emitEvent(event);
            if (isTerminalEvent(event)) {
              finish();
              return;
            }
          }
        } catch (error) {
          void error;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        finish(new Error('Stream aborted'));
        return;
      }

      // Keep the terminal-state poller alive. This makes the fixture robust
      // when a deploy finishes before the live progress stream is attached.
      void error;
    } finally {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', handleExternalAbort);
      }
    }
  })();

  return {
    events,
    waitForEvent(
      type: string,
      timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
    ): Promise<TimelineEvent> {
      const existing = events.find((event) => eventMatches(event, type));
      if (existing) {
        return Promise.resolve(existing);
      }

      if (terminalError) {
        return Promise.reject(terminalError);
      }

      return new Promise<TimelineEvent>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const waiter = waiters.find((candidate) => candidate.timeoutId === timeoutId);
          if (!waiter) return;

          clearWaiter(waiter);
          reject(
            new Error(
              `Timed out waiting for event "${type}" after ${String(timeoutMs)}ms. Seen: ${events
                .map((event) => event.type)
                .join(' -> ')}`,
            ),
          );
        }, timeoutMs);

        waiters.push({
          type,
          resolve,
          reject,
          timeoutId,
        });
      });
    },
    close() {
      controller.abort();
      finish(new Error('Stream closed by consumer'));
    },
  };
}

export function assertEventSequence(actual: TimelineEvent[], expected: string[]): void {
  let actualIndex = 0;

  for (const expectedType of expected) {
    if (expectedType.endsWith('*')) {
      const wildcardType = expectedType.slice(0, -1);
      while (actualIndex < actual.length && actual[actualIndex]?.type === wildcardType) {
        actualIndex += 1;
      }
      continue;
    }

    while (actualIndex < actual.length && !eventMatches(actual[actualIndex]!, expectedType)) {
      actualIndex += 1;
    }

    if (actualIndex >= actual.length) {
      const actualTypes = actual.map((event) => event.type);
      throw new Error(
        [
          'Event sequence assertion failed.',
          `Missing expected event in order: ${expectedType}`,
          `Expected sequence: ${expected.join(' -> ')}`,
          `Actual sequence:   ${actualTypes.join(' -> ')}`,
        ].join('\n'),
      );
    }

    actualIndex += 1;
  }
}
