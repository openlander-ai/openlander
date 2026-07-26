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
import { ApiError } from '@/lib/api/client';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';
import { usePollingTask } from './use-polling-task';

const POLL_MS = 15_000;

export interface McpSessionView {
  id: string;
  transport: 'http' | 'sse';
  connectedAt: string;
  lastActivityAt: string;
  /** clientInfo.name from the MCP initialize handshake. Undefined for
   *  older clients or pre-handshake sessions. */
  clientName?: string;
  clientVersion?: string;
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
  /** DELETE /api/mcp/sessions/:id and refresh the status snapshot.
   *  Resolves to true on a 2xx server response, false otherwise. */
  disconnect: (sessionId: string) => Promise<boolean>;
}

export function useMcpStatus(): UseMcpStatusReturn {
  const { t } = useLanguage();
  const [status, setStatus] = useState<McpStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/mcp/status');
      if (!res.ok) {
        throw new ApiError('MCP status request failed', res.status);
      }
      const body = (await res.json()) as McpStatusSnapshot;
      setStatus(body);
      setError(null);
    } catch (err) {
      setError(localizeApiError(err, t, 'common.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const disconnect = useCallback(
    async (sessionId: string): Promise<boolean> => {
      try {
        const res = await fetchWithAuth(`/api/mcp/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
        });
        if (!res.ok) return false;
        await fetchStatus();
        return true;
      } catch {
        return false;
      }
    },
    [fetchStatus],
  );

  usePollingTask(fetchStatus, { intervalMs: POLL_MS });

  return { status, loading, error, refetch: fetchStatus, disconnect };
}
