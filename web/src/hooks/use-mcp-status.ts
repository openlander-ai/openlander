/**
 * useMcpStatus — polls /api/mcp/status for the active MCP session list.
 *
 * Returned session IDs are pre-truncated server-side (first 12 chars); the
 * full UUID never reaches the client. Tool-call stats are intentionally
 * omitted from the contract — that requires persistent counters and ships
 * in 1.1.
 */
import { useCallback, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';
import { usePollingTask } from './use-polling-task';

const POLL_MS = 15_000;

export interface McpSessionView {
  id: string;
  transport: 'http' | 'sse';
  connectedAt: string;
  lastActivityAt: string;
}

export interface McpStatusSnapshot {
  endpoint: string;
  totalConnected: number;
  sessions: McpSessionView[];
  /** Composite tool names registered with the MCP server (what an MCP
   *  client sees from `tools/list`). Optional for back-compat: older
   *  servers may not surface this field. */
  tools?: string[];
  /** Total underlying action count across all composites. */
  actions?: number;
}

export interface UseMcpStatusReturn {
  status: McpStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMcpStatus(): UseMcpStatusReturn {
  const [status, setStatus] = useState<McpStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/mcp/status');
      if (!res.ok) {
        throw new Error(`MCP status fetch failed: ${res.status}`);
      }
      const body = (await res.json()) as McpStatusSnapshot;
      setStatus(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch MCP status');
    } finally {
      setLoading(false);
    }
  }, []);

  usePollingTask(fetchStatus, { intervalMs: POLL_MS });

  return { status, loading, error, refetch: fetchStatus };
}
