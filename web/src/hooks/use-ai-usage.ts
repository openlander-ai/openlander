import { useState, useEffect, useCallback } from 'react';
import {
  getAiUsageSummary,
  getAiUsageRecent,
  type AiUsageSummary,
  type AiUsageLog,
} from '../lib/api/usage';

const IDLE_POLL_MS = 10_000;

export interface UseAiUsageReturn {
  summary: AiUsageSummary | null;
  recent: AiUsageLog[];
  isLoading: boolean;
  error: string | null;
}

export function useAiUsage(projectId?: string): UseAiUsageReturn {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [recent, setRecent] = useState<AiUsageLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsageData = useCallback(async () => {
    try {
      const [summaryData, recentData] = await Promise.all([
        getAiUsageSummary(projectId),
        getAiUsageRecent({ projectId, limit: 50 }),
      ]);

      setSummary(summaryData);
      setRecent(recentData.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AI usage data');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchUsageData();

    const interval = setInterval(fetchUsageData, IDLE_POLL_MS);

    // Refetch on tab focus
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchUsageData();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchUsageData]);

  return { summary, recent, isLoading, error };
}
