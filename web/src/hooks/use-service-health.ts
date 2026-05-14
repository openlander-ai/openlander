/**
 * Service health hook — Round 4 PR6.
 *
 * Polls `/api/services/:id/health` and exposes a single `health` value.
 * Used ONLY for the ServiceDetailV2 header pill — InfraMap reads the
 * topology hook's per-service `health` field instead, so we don't pay
 * N requests for N nodes.
 *
 * Cadence:
 *   - 10s while healthy (steady state)
 *   - 3s while crashed (so recovery surfaces promptly)
 *
 * 1.0-rc.2 (data-model fullsplit) note: signature unchanged — `serviceId`
 * is already the canonical service-level identifier under the new schema.
 */
import { useCallback, useState } from 'react';
import { fetchServiceHealth } from '../lib/api/services';
import type { ServiceHealth } from '../lib/projectTopology';
import { usePollingTask } from './use-polling-task';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseServiceHealthResult {
  health: ServiceHealth | null;
  isLoading: boolean;
  error: string | null;
}

export function useServiceHealth(serviceId: string | null): UseServiceHealthResult {
  const [health, setHealth] = useState<ServiceHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    if (!serviceId) {
      setIsLoading(false);
      return;
    }
    try {
      const result = await fetchServiceHealth(serviceId);
      setHealth(result);
      setError(null);
    } catch (err) {
      // Clear health on fetch failure so a stale value (e.g. the
      // last `deploying` before a failed deploy 404s the endpoint)
      // does not pin the badge while topology has already moved on
      // to `crashed`. ServiceDetailV2 reads
      // `liveHealth.health ?? resolvedService?.health`, so null lets
      // the topology snapshot take over.
      setHealth(null);
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setIsLoading(false);
    }
  }, [serviceId]);

  // Active polling for any non-steady state so the badge flips
  // promptly when a redeploy finishes or a crashed service recovers.
  const pollMs = health === 'crashed' || health === 'deploying' ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  usePollingTask(fetcher, { intervalMs: pollMs, enabled: serviceId != null });

  return { health, isLoading, error };
}
