import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLogStream, type LogEntry } from '@/hooks/use-log-stream';
import { cn } from '@/lib/utils';
import { Search, ArrowDown, Trash2, Radio } from 'lucide-react';
import { parseAnsiLine, stripAnsi } from '@/lib/ansi';

interface LogViewerProps {
  projectId: string;
}

/** Detect log level from line content */
function detectLevel(line: string): 'error' | 'warn' | 'info' | 'debug' | 'plain' {
  const lower = stripAnsi(line).toLowerCase();
  if (/\berror\b|\bfatal\b|\bpanic\b/.test(lower)) return 'error';
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\binfo\b/.test(lower)) return 'info';
  if (/\bdebug\b|\btrace\b/.test(lower)) return 'debug';
  return 'plain';
}

const levelColors: Record<string, string> = {
  error: 'text-error',
  warn: 'text-warning',
  info: 'text-agent',
  debug: 'text-muted-ol',
  plain: 'text-secondary-ol',
};

export function LogViewer({ projectId }: LogViewerProps) {
  const { t } = useLanguage();
  const [follow, setFollow] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const { entries, isConnected, error, clear } = useLogStream({
    projectId,
    follow,
    enabled: true,
  });

  // Filter entries by search
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return entries;

    try {
      if (isRegex) {
        const regex = new RegExp(searchQuery, 'i');
        return entries.filter((e) => regex.test(stripAnsi(e.line)));
      }
      const lower = searchQuery.toLowerCase();
      return entries.filter((e) => stripAnsi(e.line).toLowerCase().includes(lower));
    } catch {
      // Invalid regex — show all
      return entries;
    }
  }, [entries, searchQuery, isRegex]);

  // Memoize parsed ANSI HTML
  const parsedLines = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of filteredEntries) {
      map.set(entry.id, parseAnsiLine(entry.line));
    }
    return map;
  }, [filteredEntries]);

  // Virtual list
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  // Auto-scroll when following
  useEffect(() => {
    if (!follow || filteredEntries.length === 0) return;
    virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
  }, [filteredEntries.length, follow, virtualizer]);

  // Detect scroll up → disable follow
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (!isNearBottom && follow) {
      setFollow(false);
    }
  }, [follow]);

  const scrollToBottom = useCallback(() => {
    setFollow(true);
    if (filteredEntries.length > 0) {
      virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
    }
  }, [filteredEntries.length, virtualizer]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel/50">
        {/* Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 text-muted-ol shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={'Search logs...'}
            className={cn(
              'flex-1 bg-transparent text-xs font-mono text-primary-ol',
              'placeholder:text-muted-ol focus:outline-none',
            )}
          />
          <button
            onClick={() => setIsRegex(!isRegex)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors',
              isRegex
                ? 'bg-agent/15 text-agent border border-agent/30'
                : 'text-muted-ol hover:text-secondary-ol border border-transparent',
            )}
          >
            .*
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Follow toggle */}
          <button
            onClick={() => (follow ? setFollow(false) : scrollToBottom())}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-body transition-colors',
              follow
                ? 'bg-agent/15 text-agent border border-agent/30'
                : 'text-muted-ol hover:text-secondary-ol border border-transparent hover:border-border',
            )}
          >
            <Radio className="h-3 w-3" />
            {'Follow'}
          </button>

          {/* Clear */}
          <button
            onClick={clear}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-body text-muted-ol hover:text-secondary-ol transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            {'Clear'}
          </button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 ml-auto">
          {isConnected && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Live
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-ol">
            {filteredEntries.length.toLocaleString()} {'lines'}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 px-4 py-2 text-xs font-body text-error bg-error/5 border-b border-error/10">
          {error}
        </div>
      )}

      {/* Log content — virtualized */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto font-mono text-xs leading-5 bg-bg-app"
      >
        {filteredEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm font-body text-muted-ol">
              {entries.length === 0 ? t('logs.noLogs') : t('logs.noMatching')}
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const entry: LogEntry = filteredEntries[virtualItem.index];
              const level = entry.stream === 'stderr' ? 'error' : detectLevel(entry.line);

              return (
                <div
                  key={entry.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={cn(
                    'flex items-start px-4 hover:bg-bg-subtle/30',
                    entry.stream === 'stderr' && 'bg-error/[0.03]',
                  )}
                >
                  {/* Line number */}
                  <span className="shrink-0 w-12 text-right pr-3 text-muted-ol select-none tabular-nums">
                    {virtualItem.index + 1}
                  </span>
                  {/* Content */}
                  <span
                    className={cn('flex-1 whitespace-pre', levelColors[level])}
                    dangerouslySetInnerHTML={{ __html: parsedLines.get(entry.id) || '' }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {!follow && filteredEntries.length > 0 && (
        <button
          onClick={scrollToBottom}
          className={cn(
            'absolute bottom-4 right-4 z-10',
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'bg-bg-panel border border-[hsl(var(--border))] shadow-lg',
            'text-[11px] font-body text-secondary-ol hover:text-primary-ol transition-colors',
          )}
        >
          <ArrowDown className="h-3 w-3" />
          {'Bottom'}
        </button>
      )}
    </div>
  );
}
