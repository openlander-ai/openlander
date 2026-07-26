import { useState, useCallback } from 'react';
import { getServerStatus, getSetupStatus, type ServerStatus, type SetupStatus } from '../lib/api';
import { usePollingTask } from './use-polling-task';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

const POLL_MS = 10_000;

export interface UseSystemStatusReturn {
  serverStatus: ServerStatus | null;
  setupStatus: SetupStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSystemStatus(): UseSystemStatusReturn {
  const { t } = useLanguage();
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
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  usePollingTask(fetchStatus, { intervalMs: POLL_MS });

  return { serverStatus, setupStatus, loading, error, refetch: fetchStatus };
}
