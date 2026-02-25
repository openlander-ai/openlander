import { useState, useEffect, useCallback, useRef } from 'react';
import { OpenLanderClient } from '../../ipc/client.js';
import type { HealthResponse } from '../../ipc/client.js';

export type DaemonStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseDaemonResult {
  client: OpenLanderClient;
  status: DaemonStatus;
  health: HealthResponse | null;
  error: string | null;
  reconnect: () => void;
}

/**
 * Manage daemon connection state.
 * Pings the daemon periodically to maintain health status.
 */
export function useDaemon(socketPath: string, pingIntervalMs = 10000): UseDaemonResult {
  const clientRef = useRef<OpenLanderClient>(new OpenLanderClient(socketPath));
  const [status, setStatus] = useState<DaemonStatus>('connecting');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectedRef = useRef(false);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await clientRef.current.ping();
      setHealth(response);
      setStatus('connected');
      setError(null);
      connectedRef.current = true;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);

      if (clientRef.current.isSocketPresent()) {
        setStatus('error');
      } else {
        setStatus('disconnected');
      }
      return false;
    }
  }, []);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    setError(null);
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const FAST_INTERVAL = 1000;

    const poll = async () => {
      if (cancelled) return;
      const ok = await checkHealth();

      // Fast retry until first successful connection, then slow poll
      const interval = ok || connectedRef.current ? pingIntervalMs : FAST_INTERVAL;
      timer = setTimeout(() => { void poll(); }, interval);
    };

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkHealth, pingIntervalMs]);

  return {
    client: clientRef.current,
    status,
    health,
    error,
    reconnect,
  };
}
