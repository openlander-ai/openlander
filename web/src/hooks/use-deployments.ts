/**
 * useProjectDeployments — project-scoped deployment feed.
 *
 * Project-level history is kept for legacy/project tab callers. Service detail
 * surfaces should use `useServiceDeployments(projectId, serviceId, ...)`.
 *
 * `status` is the live status (e.g. 'building') used to bump polling
 * cadence; `environmentId` filters the deployment list when set.
 */
import { useCallback, useState } from 'react';

import { getProjectDeployments, getServiceDeployments } from '@/lib/api';
import { usePollingTask } from '@/hooks/use-polling-task';
import type { DeployLogSummary } from '@/types';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseDeploymentsReturn {
  deployments: DeployLogSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useProjectDeployments(
  projectId: string,
  status?: string,
  environmentId?: string,
): UseDeploymentsReturn {
  const { t } = useLanguage();
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await getProjectDeployments(projectId, 50, environmentId);
      setDeployments(data);
      setError(null);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [projectId, environmentId, t]);

  const pollMs = status === 'building' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  usePollingTask(fetchDeployments, {
    enabled: Boolean(projectId),
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

export function useServiceDeployments(
  projectId: string,
  serviceId: string,
  status?: string,
  environmentId?: string,
): UseDeploymentsReturn {
  const { t } = useLanguage();
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = useCallback(async () => {
    try {
      const data = await getServiceDeployments(projectId, serviceId, 50, environmentId);
      setDeployments(data);
      setError(null);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [projectId, serviceId, environmentId, t]);

  const pollMs = status === 'building' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  usePollingTask(fetchDeployments, {
    enabled: Boolean(projectId && serviceId),
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
