import { useEffect, useRef, useState } from 'react';

import { fetchActivityFeed, type ActivityItem } from '../lib/api/operations';

export function useActivityStream(options?: { projectId?: string; types?: string[] }) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchActivityFeed({ projectId: options?.projectId, types: options?.types, limit: 50 })
      .then(({ activities: initial }) => {
        if (!cancelled) setActivities(initial);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const controller = new AbortController();
    abortRef.current = controller;
    const params = new URLSearchParams({ follow: 'true' });
    if (options?.projectId) params.set('projectId', options.projectId);
    if (options?.types?.length) params.set('types', options.types.join(','));

    void (async () => {
      try {
        const resp = await fetch(`/api/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include',
        });
        if (!resp.ok || !resp.body) {
          if (!cancelled) setError(new Error(`Stream error: ${resp.status}`));
          return;
        }
        if (!cancelled) setIsConnected(true);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelled) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const item = JSON.parse(trimmed) as ActivityItem;
              if (!cancelled) setActivities((prev) => [item, ...prev].slice(0, 500));
            } catch {
              // ignore malformed NDJSON lines
            }
          }
        }
      } catch (err) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') setError(err);
      } finally {
        if (!cancelled) setIsConnected(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      abortRef.current = null;
    };
  }, [options?.projectId, options?.types?.join(',')]);

  return { activities, isConnected, loading, error };
}
