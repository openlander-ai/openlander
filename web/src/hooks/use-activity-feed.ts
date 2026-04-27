/**
 * useActivityFeed — polls /api/activity for the v4 cross-actor timeline
 * (deploy_*, service_crashed, mcp_connected, …).
 *
 * Polling cadence (15s) matches health/topology cache TTLs already in repo.
 * The endpoint returns a fresh snapshot every call; the hook does not merge
 * across calls beyond replacing state, which keeps event ordering tied to
 * server-side merge sort.
 */
import { useCallback, useMemo, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';
import type { ActivityEvent, Actor } from '@/lib/agentActivity';
import { usePollingTask } from './use-polling-task';

const POLL_MS = 15_000;

export interface UseActivityFeedOptions {
  limit?: number;
  /** Filter by actor. Pass undefined / 'all' to include all actors. */
  actor?: Actor | 'all';
  /** Filter by project ID. Pass undefined / 'all' to include all. */
  project?: string | 'all';
}

export interface UseActivityFeedReturn {
  events: ActivityEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface ActivityResponse {
  activities: ActivityEvent[];
}

export function useActivityFeed(options: UseActivityFeedOptions = {}): UseActivityFeedReturn {
  const { limit = 100, actor, project } = options;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (actor && actor !== 'all') params.set('actor', actor);
    if (project && project !== 'all') params.set('project', project);
    return params.toString();
  }, [limit, actor, project]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/activity?${queryString}`);
      if (!res.ok) {
        throw new Error(`Activity fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as ActivityResponse;
      setEvents(body.activities ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch activity feed');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  usePollingTask(fetchEvents, { intervalMs: POLL_MS });

  return { events, loading, error, refetch: fetchEvents };
}
