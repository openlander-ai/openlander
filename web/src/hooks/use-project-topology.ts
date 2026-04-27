/**
 * Project topology hook — Round 4 PR6.
 *
 * Polls `/api/projects/:id/topology` and exposes `services[]` with mock
 * fallback. Polling cadence:
 *   - 10s when all services healthy
 *   - 3s when any service is `crashed` (so the InfraMap node-color
 *     transitions promptly when something recovers / gets worse)
 *
 * Transient-error policy:
 *   - When a poll fails AFTER we already have data, keep the last-good
 *     copy. We don't flicker back to mock just because one fetch blipped.
 *   - When we've never had a successful fetch (initial mount or 404), the
 *     consumer sees the mock data so the UI is usable offline / before
 *     the backend session ships the endpoint.
 *
 * Disabled when `projectId` is null — usePollingTask short-circuits via
 * `enabled: false` and the resolved services array is empty.
 */
import { useCallback, useMemo, useState } from 'react';
import { fetchProjectTopology } from '../lib/api/topology';
import { getServices, type ServiceNode } from '../lib/projectTopology';
import { usePollingTask } from './use-polling-task';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseProjectTopologyResult {
  services: ServiceNode[];
  isLoading: boolean;
  error: string | null;
  /** True when the consumer is seeing mock data (no successful fetch yet). */
  isMockFallback: boolean;
  refetch: () => void;
}

export function useProjectTopology(projectId: string | null): UseProjectTopologyResult {
  const [services, setServices] = useState<ServiceNode[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!projectId) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await fetchProjectTopology(projectId);
      setServices(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch topology');
      // Keep last-good data — don't flicker to mock on transient blips.
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const hasCrashed = useMemo(
    () => (services ?? []).some((s) => s.health === 'crashed'),
    [services],
  );
  const pollMs = hasCrashed ? ACTIVE_POLL_MS : IDLE_POLL_MS;

  usePollingTask(fetcher, { intervalMs: pollMs, enabled: projectId != null });

  const resolvedServices = useMemo(() => {
    if (services != null) return services;
    if (!projectId) return [];
    return getServices(projectId);
  }, [services, projectId]);

  return {
    services: resolvedServices,
    isLoading,
    error,
    isMockFallback: services == null,
    refetch: fetcher,
  };
}
