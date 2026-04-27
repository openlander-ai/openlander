/**
 * Service metrics hook — Round 4 PR6.
 *
 * Polls `/api/services/:id/metrics?range=…` for the MonitoringTab 2×2
 * sparkline grid. The range param is part of the fetcher closure, so
 * usePollingTask re-runs whenever the user toggles the range pill.
 *
 * Fallback policy:
 *   - If the fetch fails or `serviceId` is null, the result's `metrics`
 *     stays null and the consumer renders deterministicSeries instead.
 *   - We DON'T eagerly fall back to deterministicSeries inside the hook
 *     — that's the consumer's call so it can keep deterministic series
 *     stable across re-renders via useMemo.
 *
 * 10s flat polling — fast enough to feel live without melting a
 * single-tenant box.
 */
import { useCallback, useState } from 'react';
import { fetchServiceMetrics, type MetricsRange, type ServiceMetrics } from '../lib/api/services';
import { usePollingTask } from './use-polling-task';

const POLL_MS = 10_000;

export interface UseServiceMetricsResult {
  metrics: ServiceMetrics | null;
  isLoading: boolean;
  error: string | null;
}

export function useServiceMetrics(
  serviceId: string | null,
  range: MetricsRange,
): UseServiceMetricsResult {
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!serviceId) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await fetchServiceMetrics(serviceId, range);
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setIsLoading(false);
    }
  }, [serviceId, range]);

  usePollingTask(fetcher, { intervalMs: POLL_MS, enabled: serviceId != null });

  return { metrics, isLoading, error };
}
