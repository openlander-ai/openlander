import { useState, useEffect, useRef } from 'react';
import type { OpenLanderClient, ActivityEvent } from '../../ipc/client.js';

export interface UseActivityResult {
  events: ActivityEvent[];
  isStreaming: boolean;
  error: string | null;
}

/**
 * Stream activity events from the daemon via NDJSON.
 * Falls back to polling if streaming fails.
 */
export function useActivity(client: OpenLanderClient, maxEvents = 50): UseActivityResult {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    // First load: fetch recent activity
    void client.getActivity(maxEvents).then(
      (initial) => {
        setEvents(initial);
      },
      () => {
        // Daemon may not be ready yet — ignore
      },
    );

    // Then stream new events
    void (async () => {
      try {
        setIsStreaming(true);
        for await (const event of client.streamActivity(controller.signal)) {
          setEvents((prev) => {
            const next = [event, ...prev];
            return next.length > maxEvents ? next.slice(0, maxEvents) : next;
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Activity stream failed');
        setIsStreaming(false);

        // Fallback to polling
        const poll = setInterval(() => {
          void client.getActivity(maxEvents).then(
            (data) => setEvents(data),
            () => {
              /* ignore */
            },
          );
        }, 5000);

        // Cleanup polling on abort
        controller.signal.addEventListener('abort', () => clearInterval(poll), { once: true });
      }
    })();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [client, maxEvents]);

  return { events, isStreaming, error };
}
