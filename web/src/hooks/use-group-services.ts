/**
 * useGroupServices — 1.0-rc.2 (data-model fullsplit).
 *
 * Returns the list of Application/Compose workload rows attached to a Project via the
 * canonical endpoint `GET /api/projects/:p/services` (P2 backend filters
 * to `kind NOT IN [postgres, mysql, redis, mongo, minio]`).
 *
 * This hook complements `useProjectsContext()` (which exposes Projects)
 * — when a consumer needs the workload list under a specific Project, it
 * calls this instead of reading per-service fields off the projects array.
 *
 * Polling cadence mirrors `useProjects()`:
 *   - 10s steady state
 *   - 3s while any service is `building`
 *
 * Disabled when `groupId` is null — usePollingTask short-circuits via
 * `enabled: false` and the resolved services array is empty.
 */
import { useCallback, useMemo, useState } from 'react';
import { listGroupServices, type GroupService } from '../lib/api/services';
import { usePollingTask } from './use-polling-task';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseGroupServicesResult {
  services: GroupService[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useGroupServices(groupId: string | null): UseGroupServicesResult {
  const { t } = useLanguage();
  const [services, setServices] = useState<GroupService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    try {
      const data = await listGroupServices(groupId);
      setServices(data);
      setError(null);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [groupId, t]);

  const hasBuilding = useMemo(() => services.some((s) => s.status === 'building'), [services]);
  const pollMs = hasBuilding ? ACTIVE_POLL_MS : IDLE_POLL_MS;

  usePollingTask(fetcher, { intervalMs: pollMs, enabled: groupId != null });

  return {
    services,
    loading,
    error,
    refetch: () => {
      void fetcher();
    },
  };
}
