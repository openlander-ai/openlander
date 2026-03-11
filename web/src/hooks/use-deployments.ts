import { useCallback, useEffect, useState } from 'react';

import { getProjectDeployments } from '@/lib/api';
import type { DeployLogSummary } from '@/types';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseDeploymentsReturn {
  deployments: DeployLogSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDeployments(projectId: string, projectStatus?: string): UseDeploymentsReturn {
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await getProjectDeployments(projectId);
      setDeployments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deployments');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchDeployments();

    const pollMs = projectStatus === 'building' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const interval = setInterval(() => void fetchDeployments(), pollMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchDeployments();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchDeployments, projectStatus]);

  return {
    deployments,
    loading,
    error,
    refetch: () => {
      void fetchDeployments();
    },
  };
}
