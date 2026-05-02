import type { TimelineEvent } from './event-types.js';

const BASE_URL = 'http://localhost:10114';
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

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
    terminalError = error ?? new Error('Stream closed before expected event');
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
    events.push(event);

    for (const waiter of [...waiters]) {
      if (!eventMatches(event, waiter.type)) continue;
      clearWaiter(waiter);
      waiter.resolve(event);
    }
  };

  void (async () => {
    try {
      const authHdrs: Record<string, string> = {};
      if (process.env.OPENLANDER_API_TOKEN) {
        authHdrs['Authorization'] = `Bearer ${process.env.OPENLANDER_API_TOKEN}`;
      } else if (process.env.OPENLANDER_SESSION) {
        authHdrs['Cookie'] = `ol_session=${process.env.OPENLANDER_SESSION}`;
      }
      // TODO(0.1.x): /api/projects/:id/build/stream removed — migrate to /api/builds/:id/progress (see deploy-failure-handler.ts:322).
      const response = await fetch(`${BASE_URL}/api/projects/${projectId}/build/stream`, {
        signal: controller.signal,
        headers: authHdrs,
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
            const event = JSON.parse(line) as TimelineEvent;
            emitEvent(event);
          } catch (error) {
            void error;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as TimelineEvent;
          emitEvent(event);
        } catch (error) {
          void error;
        }
      }

      finish(new Error('Stream ended before expected event'));
    } catch (error) {
      if (controller.signal.aborted) {
        finish(new Error('Stream aborted'));
        return;
      }

      const message = error instanceof Error ? error.message : 'Stream failed';
      finish(new Error(message));
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
