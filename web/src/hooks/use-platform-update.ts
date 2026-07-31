import { useCallback, useState } from 'react';
import { usePollingTask } from '@/hooks/use-polling-task';
import {
  getPlatformUpdateStatus,
  startPlatformUpdate,
  type PlatformUpdateOperation,
  type PlatformUpdateStatus,
} from '@/lib/api/system';

const IDLE_POLL_MS = 30 * 60 * 1000;
const STALE_POLL_MS = 2 * 60 * 1000;
const ACTIVE_POLL_MS = 2_000;
const ACTIVE_PHASES = new Set([
  'preparing',
  'backing_up',
  'pulling',
  'restarting',
  'verifying',
  'rolling_back',
]);
const TERMINAL_PHASES = new Set(['completed', 'rolled_back', 'failed']);

export function isPlatformUpdateActive(operation: PlatformUpdateOperation | null): boolean {
  return Boolean(operation && ACTIVE_PHASES.has(operation.phase));
}

export function hasNewerPlatformRelease(
  status: Pick<PlatformUpdateStatus, 'release' | 'updateAvailable'>,
  operation: PlatformUpdateOperation | null,
): boolean {
  return Boolean(
    operation &&
    TERMINAL_PHASES.has(operation.phase) &&
    status.updateAvailable &&
    status.release &&
    operation.targetVersion !== status.release.version,
  );
}

export interface UsePlatformUpdateReturn {
  status: PlatformUpdateStatus | null;
  loading: boolean;
  checking: boolean;
  submitting: boolean;
  disconnected: boolean;
  reconnecting: boolean;
  refresh: () => Promise<void>;
  checkNow: () => Promise<void>;
  startUpdate: (targetVersion: string) => Promise<void>;
}

export function usePlatformUpdate(): UsePlatformUpdateReturn {
  const [status, setStatus] = useState<PlatformUpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [reconnectPending, setReconnectPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getPlatformUpdateStatus();
      setStatus(nextStatus);
      setDisconnected(false);
      setReconnectPending(false);
    } catch {
      // Keep the last successful status visible while the OpenLander container restarts.
      setDisconnected(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const active =
    submitting || reconnectPending || isPlatformUpdateActive(status?.operation ?? null);
  const pollInterval = active
    ? ACTIVE_POLL_MS
    : status?.releaseCheckStale
      ? STALE_POLL_MS
      : IDLE_POLL_MS;
  usePollingTask(refresh, { intervalMs: pollInterval });

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      const nextStatus = await getPlatformUpdateStatus({ refreshRelease: true });
      setStatus(nextStatus);
      setDisconnected(false);
      setReconnectPending(false);
    } catch (error) {
      setDisconnected(true);
      throw error;
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  const startUpdate = useCallback(
    async (targetVersion: string) => {
      setSubmitting(true);
      setReconnectPending(true);
      try {
        const result = await startPlatformUpdate(targetVersion);
        setStatus((current) =>
          current ? { ...current, canUpdate: false, operation: result.operation } : current,
        );
        setDisconnected(false);
        setReconnectPending(false);
        await refresh();
      } catch (error) {
        setReconnectPending(true);
        await refresh();
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [refresh],
  );

  return {
    status,
    loading,
    checking,
    submitting,
    disconnected,
    reconnecting: reconnectPending,
    refresh,
    checkNow,
    startUpdate,
  };
}
