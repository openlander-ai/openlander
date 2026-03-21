import { useState, useEffect, useCallback } from 'react';
import { getServerStatus, getSetupStatus, type ServerStatus, type SetupStatus } from '../lib/api';

const POLL_MS = 10_000;

export interface UseSystemStatusReturn {
  serverStatus: ServerStatus | null;
  setupStatus: SetupStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSystemStatus(): UseSystemStatusReturn {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [server, setup] = await Promise.all([getServerStatus(), getSetupStatus()]);
      setServerStatus(server);
      setSetupStatus(setup);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    const interval = setInterval(fetchStatus, POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchStatus();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchStatus]);

  return { serverStatus, setupStatus, loading, error, refetch: fetchStatus };
}
