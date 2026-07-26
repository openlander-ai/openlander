import { useCallback, useState } from 'react';
import { listPendingApprovals, type PendingApproval } from '@/lib/api';
import { usePollingTask } from './use-polling-task';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

const POLL_MS = 1_500;

export interface UsePendingApprovalsReturn {
  approvals: PendingApproval[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePendingApprovals(enabled = true): UsePendingApprovalsReturn {
  const { t } = useLanguage();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    if (!enabled) return;
    try {
      const body = await listPendingApprovals();
      setApprovals(body.approvals ?? []);
      setError(null);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [enabled, t]);

  usePollingTask(fetchApprovals, {
    intervalMs: POLL_MS,
    enabled,
    pauseWhenHidden: true,
    refetchOnVisible: true,
  });

  return { approvals, loading, error, refetch: fetchApprovals };
}
