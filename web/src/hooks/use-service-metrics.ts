/**
 * Service metrics hook — Round 4 PR6.
 *
 * Polls `/api/services/:id/metrics?range=…` for the MonitoringTab 2×2
 * sparkline grid. The range param is part of the fetcher closure, so
 * usePollingTask re-runs whenever the user toggles the range pill.
 *
 * Fallback policy:
 *   - 204 No Content → `isEmpty: true`, `metrics: null`. Consumer renders
 *     an empty state (Principle 4: no synthetic/deterministic path here).
 *   - Other errors → `error` set, last-good `metrics` kept if available.
 *   - When `serviceId` is null → hook is disabled, no fetch runs.
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
  /** True when the backend returned 204 No Content (no metrics history yet). */
  isEmpty: boolean;
  isLoading: boolean;
  error: string | null;
}

export function useServiceMetrics(
  serviceId: string | null,
  range: MetricsRange,
): UseServiceMetricsResult {
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!serviceId) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await fetchServiceMetrics(serviceId, range);
      if (data === null) {
        setIsEmpty(true);
        setMetrics(null);
      } else {
        setIsEmpty(false);
        setMetrics(data);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setIsLoading(false);
    }
  }, [serviceId, range]);

  usePollingTask(fetcher, { intervalMs: POLL_MS, enabled: serviceId != null });

  return { metrics, isEmpty, isLoading, error };
}
