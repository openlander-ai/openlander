/**
 * useMonitoring — polls /api/monitoring/services for the v4 service-aggregate
 * dashboard (ralplan-monitoring-logs Phase 2).
 *
 * 15s cadence matches the rest of the v4 polling surfaces (health/topology
 * cache TTLs in repo). Server-side fan-out — no per-service N+1 fetch.
 */
import { useCallback, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';
import { usePollingTask } from './use-polling-task';

const POLL_MS = 15_000;

export interface MonitoringServiceView {
  serviceId: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  status: string;
  health: 'healthy' | 'unhealthy' | 'unknown';
  cpu60: number[];
  mem60: number[];
  lastSampleAt: number | null;
  stale: boolean;
}

export interface MonitoringSnapshot {
  services: MonitoringServiceView[];
  excluded: number;
  total: number;
}

export interface UseMonitoringOptions {
  project?: string | 'all';
}

export interface UseMonitoringReturn {
  snapshot: MonitoringSnapshot | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMonitoring(options: UseMonitoringOptions = {}): UseMonitoringReturn {
  const { project } = options;
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (project && project !== 'all') params.set('project', project);
      const qs = params.toString();
      const res = await fetchWithAuth(`/api/monitoring/services${qs ? `?${qs}` : ''}`);
      if (!res.ok) {
        throw new Error(`Monitoring fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as MonitoringSnapshot;
      setSnapshot(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch monitoring snapshot');
    } finally {
      setLoading(false);
    }
  }, [project]);

  usePollingTask(fetchSnapshot, { intervalMs: POLL_MS });

  return { snapshot, loading, error, refetch: fetchSnapshot };
}
