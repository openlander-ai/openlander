import { createSignal, createEffect, onCleanup } from 'solid-js';
import { OpenLanderClient } from '../../ipc/client.js';
import type { HealthResponse } from '../../ipc/client.js';

export type DaemonStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseDaemonResult {
  client: OpenLanderClient;
  status: () => DaemonStatus;
  health: () => HealthResponse | null;
  error: () => string | null;
  reconnect: () => void;
}

/**
 * Manage daemon connection state.
 * Pings the daemon periodically to maintain health status.
 */
export function useDaemon(socketPath: string, pingIntervalMs = 30000): UseDaemonResult {
  const client = new OpenLanderClient(socketPath);
  const [status, setStatus] = createSignal<DaemonStatus>('connecting');
  const [health, setHealth] = createSignal<HealthResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let connectedRef = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const checkHealth = async (): Promise<boolean> => {
    try {
      const response = await client.ping();
      // Only update state if something changed
      if (!connectedRef) {
        setHealth(response);
        setStatus('connected');
        setError(null);
        connectedRef = true;
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (connectedRef) {
        // Was connected, now failed — update state
        setError(msg);
        connectedRef = false;
      }

      if (client.isSocketPresent()) {
        setStatus('error');
      } else {
        setStatus('disconnected');
      }
      return false;
    }
  };

  const reconnect = () => {
    setStatus('connecting');
    setError(null);
    void checkHealth();
  };

  const FAST_INTERVAL = 1000;

  const poll = async () => {
    if (cancelled) return;
    const ok = await checkHealth();

    // Fast retry until first successful connection, then slow poll
    const interval = ok || connectedRef ? pingIntervalMs : FAST_INTERVAL;
    timer = setTimeout(() => {
      void poll();
    }, interval);
  };

  createEffect(() => {
    void poll();

    onCleanup(() => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    });
  });

  return {
    client,
    status,
    health,
    error,
    reconnect,
  };
}
