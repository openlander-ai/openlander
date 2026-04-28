/**
 * useDeployments — 1.0-rc.2 (data-model fullsplit).
 *
 * Parameter `serviceId` (renamed from `projectId`) is the new
 * service-level identifier — for legacy deployables the value is the
 * same as the historical project id (backend resolves both forms in
 * transition via additive schema), so call sites that previously passed
 * a project id continue to work without code changes during 1.0-rc.2.
 *
 * `status` is the live status (e.g. 'building') used to bump polling
 * cadence; `environmentId` filters the deployment list when set.
 */
import { useCallback, useState } from 'react';

import { getProjectDeployments } from '@/lib/api';
import { usePollingTask } from '@/hooks/use-polling-task';
import type { DeployLogSummary } from '@/types';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseDeploymentsReturn {
  deployments: DeployLogSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeployments(
  serviceId: string,
  status?: string,
  environmentId?: string,
): UseDeploymentsReturn {
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await getProjectDeployments(serviceId, 50, environmentId);
      setDeployments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deployments');
    } finally {
      setLoading(false);
    }
  }, [serviceId, environmentId]);

  const pollMs = status === 'building' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  usePollingTask(fetchDeployments, {
    enabled: Boolean(serviceId),
    intervalMs: pollMs,
  });

  return {
    deployments,
    loading,
    error,
    refetch: () => {
      void fetchDeployments();
    },
  };
}
