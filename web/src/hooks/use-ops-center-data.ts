import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchAllCircuitBreakers,
  fetchOpsIncidents,
  type ActivityItem,
  type CircuitBreakerWithProject,
  type OpsIncident,
} from '../lib/api/operations';
import { fetchPendingApprovals, type ActionRun } from '../lib/api/projects';
import { type AgentActiveState } from './use-agent-activity';
import { fetchWithAuth } from '../lib/api/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_MAX = 500;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 3_000; // ms

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OpsCenterData {
  activities: ActivityItem[];
  incidents: OpsIncident[];
  circuitBreakers: CircuitBreakerWithProject[];
  approvals: ActionRun[];
  agentStatus: AgentActiveState;
  isConnected: boolean;
  isReconnecting: boolean;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOpsCenterData(): OpsCenterData {
  // --- Core state ---
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreakerWithProject[]>([]);
  const [approvals, setApprovals] = useState<ActionRun[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentActiveState>({ isActive: false });
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Refs for SSE lifecycle ---
  const abortRef = useRef<AbortController | null>(null);
  const retriesRef = useRef(0);
  const lastEventTimestampRef = useRef<string | null>(null);
  const dedupSetRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Deduplication helper: returns true if the item is new (not a dup)
  // ---------------------------------------------------------------------------
  const dedup = useCallback((id: string): boolean => {
    const s = dedupSetRef.current;
    if (s.has(id)) return false;
    s.add(id);
    // Prune when set exceeds 2x buffer to bound memory
    if (s.size > BUFFER_MAX * 2) {
      const arr = [...s];
      dedupSetRef.current = new Set(arr.slice(arr.length - BUFFER_MAX));
    }
    return true;
  }, []);

  // ---------------------------------------------------------------------------
  // SSE connect with backfill + exponential backoff reconnect
  // ---------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (cancelledRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const params = new URLSearchParams({ follow: 'true' });
        if (lastEventTimestampRef.current) {
          params.set('since', lastEventTimestampRef.current);
        }

        const resp = await fetch(`/api/ops/activity?${params.toString()}`, {
          signal: controller.signal,
          credentials: 'include',
        });

        if (!resp.ok || !resp.body) {
          if (!cancelledRef.current) {
            setError(`Stream error: ${resp.status}`);
          }
          return;
        }

        if (!cancelledRef.current) {
          setIsConnected(true);
          setIsReconnecting(false);
          retriesRef.current = 0; // reset on successful connection
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let inBackfill = false;
        let backfillBatch: ActivityItem[] = [];

        for (;;) {
          const { value, done } = await reader.read();
          if (done || cancelledRef.current) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>;

              // Handle backfill-complete sentinel
              if (parsed.type === 'backfill-complete') {
                if (backfillBatch.length > 0) {
                  // Batch-apply all backfill items in one state update
                  const batch = backfillBatch;
                  backfillBatch = [];
                  setActivities((prev) => {
                    const merged = [...batch, ...prev];
                    // Deduplicate already handled per-item, just enforce ceiling
                    return merged.slice(0, BUFFER_MAX);
                  });
                }
                inBackfill = false;
                continue;
              }

              const item = parsed as unknown as ActivityItem;
              if (!item.id) continue;

              // Track last event timestamp for gap recovery
              if (item.timestamp) {
                lastEventTimestampRef.current = item.timestamp;
              }

              if (!dedup(item.id)) continue;

              if (parsed.backfill === true) {
                inBackfill = true;
                backfillBatch.push(item);
              } else if (inBackfill) {
                // Non-backfill item arriving during backfill — buffer it too
                backfillBatch.push(item);
              } else {
                // Incremental live update
                setActivities((prev) => [item, ...prev].slice(0, BUFFER_MAX));
              }
            } catch {
              // Ignore malformed NDJSON lines
            }
          }
        }

        // Stream ended normally — attempt reconnect if still mounted
        if (!cancelledRef.current && retriesRef.current < MAX_RETRIES) {
          retriesRef.current += 1;
          setIsConnected(false);
          setIsReconnecting(true);
          const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
          setTimeout(() => {
            if (!cancelledRef.current) {
              setIsReconnecting(false);
              connect();
            }
          }, delay);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        if (!cancelledRef.current) {
          const message = err instanceof Error ? err.message : 'Stream failed';
          setError(message);
          setIsConnected(false);

          // Auto-retry with exponential backoff
          if (retriesRef.current < MAX_RETRIES) {
            retriesRef.current += 1;
            setIsReconnecting(true);
            const delay = BASE_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
            setTimeout(() => {
              if (!cancelledRef.current) {
                setIsReconnecting(false);
                connect();
              }
            }, delay);
          }
        }
      }
    })();
  }, [dedup]);

  // ---------------------------------------------------------------------------
  // Initial parallel REST snapshot + SSE connect
  // ---------------------------------------------------------------------------
  useEffect(() => {
    cancelledRef.current = false;
    setIsLoading(true);

    // Parallel REST snapshot
    Promise.all([
      fetch('/api/ops/activity?limit=100', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error(`Activity fetch failed: ${r.status}`);
        return r.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
      }),
      fetchOpsIncidents(undefined, 'open'),
      fetchAllCircuitBreakers(),
      fetchPendingApprovals().catch(() => [] as ActionRun[]),
      fetchWithAuth('/api/ops/agent/active')
        .then((r) => (r.ok ? (r.json() as Promise<AgentActiveState>) : { isActive: false }))
        .catch(() => ({ isActive: false }) as AgentActiveState),
    ])
      .then(([activityData, incidentData, cbData, approvalData, agentData]) => {
        if (cancelledRef.current) return;

        const items = activityData.activities.slice(0, BUFFER_MAX);
        // Seed dedup set with initial snapshot IDs
        for (const item of items) {
          dedupSetRef.current.add(item.id);
        }
        // Track last event timestamp for SSE gap recovery
        if (items.length > 0) {
          lastEventTimestampRef.current = items[0].timestamp;
        }

        setActivities(items);
        setIncidents(incidentData.incidents ?? []);
        setCircuitBreakers(cbData.breakers ?? []);
        setApprovals(approvalData);
        setAgentStatus(agentData as AgentActiveState);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setIsLoading(false);

        // Open SSE after snapshot
        if (!cancelledRef.current) {
          retriesRef.current = 0;
          connect();
        }
      });

    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      abortRef.current = null;
      dedupSetRef.current.clear();
    };
  }, [connect]);

  // ---------------------------------------------------------------------------
  // Manual retry: reset error and reconnect
  // ---------------------------------------------------------------------------
  const retry = useCallback(() => {
    setError(null);
    setIsLoading(true);
    retriesRef.current = 0;
    connect();
  }, [connect]);

  return {
    activities,
    incidents,
    circuitBreakers,
    approvals,
    agentStatus,
    isConnected,
    isReconnecting,
    isLoading,
    error,
    retry,
  };
}
