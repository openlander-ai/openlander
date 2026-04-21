import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { getServiceLogs } from '@/lib/api';
import { cn } from '@/lib/utils';
import { parseAnsiLine } from '@/lib/ansi';

interface ServiceLogViewerProps {
  serviceId: string;
  status: string;
}

export function ServiceLogViewer({ serviceId, status }: ServiceLogViewerProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<number>(100);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    if (status !== 'running') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getServiceLogs(serviceId, lines);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [serviceId, lines, status]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (status !== 'running') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-bg-panel/60 p-5 text-center shadow-sm">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-ol mb-3" />
          <p className="text-sm font-body font-medium text-primary-ol">Service is stopped</p>
          <p className="mt-2 text-sm font-body text-muted-ol">
            Start the service to view its logs.
          </p>
        </div>
      </div>
    );
  }

  const logLines = logs.split('\n').filter((line) => line.trim() !== '');

  return (
    <div className="flex flex-col h-full border border-[hsl(var(--border))] rounded-lg overflow-hidden bg-bg-app">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel">
        <div className="flex items-center gap-3">
          <span className="text-xs font-body text-muted-ol">Showing last</span>
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="bg-transparent text-xs font-mono text-primary-ol focus:outline-none border border-[hsl(var(--border))] rounded px-2 py-1 cursor-pointer hover:border-muted-foreground"
          >
            <option value={100} className="bg-bg-panel">
              100 lines
            </option>
            <option value={200} className="bg-bg-panel">
              200 lines
            </option>
            <option value={500} className="bg-bg-panel">
              500 lines
            </option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-ol">{logLines.length} lines</span>
          <div className="w-px h-4 bg-[hsl(var(--border))]" />
          <button
            type="button"
            onClick={() => void fetchLogs()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-body text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Log content */}
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs leading-5 p-4">
        {loading && !logs ? (
          <div className="flex items-center justify-center h-full text-muted-ol">
            Loading logs...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-error">{error}</div>
        ) : logLines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-ol">
            No logs available
          </div>
        ) : (
          <div className="flex flex-col">
            {logLines.map((line, i) => (
              <div
                key={i}
                className="flex items-start hover:bg-bg-subtle/50 group border-b border-transparent hover:border-[hsl(var(--border))]/30 transition-colors"
              >
                <span className="shrink-0 w-12 text-right pr-3 text-muted-ol/40 group-hover:text-muted-ol select-none tabular-nums text-xs leading-5">
                  {i + 1}
                </span>
                <span
                  className="flex-1 whitespace-pre-wrap break-all text-secondary-ol"
                  dangerouslySetInnerHTML={{ __html: parseAnsiLine(line) }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
