import { createSignal, onCleanup } from 'solid-js';
import type { OpenLanderClient, ActivityEvent } from '../../ipc/client.js';

export interface UseActivityResult {
  events: () => ActivityEvent[];
  isStreaming: () => boolean;
  error: () => string | null;
}

/**
 * Stream activity events from the daemon via NDJSON.
 * Falls back to polling if streaming fails.
 */
export function useActivity(client: OpenLanderClient, maxEvents = 50): UseActivityResult {
  const [events, setEvents] = createSignal<ActivityEvent[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let abortController: AbortController | null = null;

  // Setup streaming
  const setup = async () => {
    const controller = new AbortController();
    abortController = controller;

    // First load: fetch recent activity
    try {
      const initial = await client.getActivity(maxEvents);
      setEvents(initial);
    } catch {
      // Daemon may not be ready yet — ignore
    }

    // Then stream new events
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
          (data) => {
            setEvents(data);
          },
          () => {
            /* ignore */
          },
        );
      }, 5000);

      // Cleanup polling on abort
      controller.signal.addEventListener('abort', () => {
        clearInterval(poll);
      });
    }
  };

  void setup();

  onCleanup(() => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  });

  return { events, isStreaming, error };
}
