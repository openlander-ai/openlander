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
 * Disabled when `groupId` is null — usePollingTask short-circuits via
 * `enabled: false` and the resolved services array is empty.
 *
 * 1.0-rc.2 (data-model fullsplit) note: the param `groupId` formerly
 * meant `projectId`. The endpoint URL `/api/projects/:id/topology`
 * unchanged — the path segment now identifies a *group*. Return-shape
 * (per-service node fields) maps natively from the new schema; group
 * fields no longer appear on service nodes.
 */
import { useCallback, useMemo, useState } from 'react';
import { fetchProjectTopology } from '../lib/api/topology';
import { getServices, type ServiceNode } from '../lib/projectTopology';
import { usePollingTask } from './use-polling-task';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';

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
  const { t } = useLanguage();
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
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
      // Keep last-good data — don't flicker to mock on transient blips.
    } finally {
      setIsLoading(false);
    }
  }, [projectId, t]);

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
