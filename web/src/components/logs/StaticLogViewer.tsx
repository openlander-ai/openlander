import { useState, useRef, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Search, Terminal, Trash2 } from 'lucide-react';
import { parseAnsiLine } from '@/lib/ansi';
import { detectLevel, levelColors } from '@/lib/log-utils';
import { useLanguage } from '@/i18n/context';
import {
  CONSOLE_LABELS,
  DEFAULT_CONSOLE_FILTER_STATE,
  type ConsoleFilterState,
  type ConsoleLogLevelFilter,
} from '@/types';

interface StaticLogViewerProps {
  content: string | null;
  className?: string;
}

interface StaticLogEntry {
  id: number;
  line: string;
}

export function StaticLogViewer({ content, className }: StaticLogViewerProps) {
  const { t } = useLanguage();
  const [filters, setFilters] = useState<
    Pick<ConsoleFilterState, 'searchMode' | 'searchQuery' | 'logLevel'>
  >({
    searchMode: DEFAULT_CONSOLE_FILTER_STATE.searchMode,
    searchQuery: DEFAULT_CONSOLE_FILTER_STATE.searchQuery,
    logLevel: DEFAULT_CONSOLE_FILTER_STATE.logLevel,
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const parseCacheRef = useRef(new Map<number, string>());
  const isRegex = filters.searchMode === 'regex';

  const entries: StaticLogEntry[] = useMemo(() => {
    if (content == null || content === '') return [];
    const lines = content.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines.map((line, i) => ({ id: i, line }));
  }, [content]);

  const hasActiveFilters = filters.searchQuery.trim().length > 0 || filters.logLevel !== 'all';

  const filteredEntries = useMemo(() => {
    let result = entries;

    if (filters.logLevel !== 'all') {
      result = result.filter((e) => detectLevel(e.line) === filters.logLevel);
    }

    if (!filters.searchQuery.trim()) return result;

    try {
      if (isRegex) {
        const regex = new RegExp(filters.searchQuery, 'i');
        return result.filter((e) => regex.test(e.line));
      }
      const lower = filters.searchQuery.toLowerCase();
      return result.filter((e) => e.line.toLowerCase().includes(lower));
    } catch {
      return result;
    }
  }, [entries, filters.searchQuery, filters.logLevel, isRegex]);

  const getParsedHtml = useCallback((entry: StaticLogEntry): string => {
    const cached = parseCacheRef.current.get(entry.id);
    if (cached != null) return cached;
    const html = parseAnsiLine(entry.line);
    parseCacheRef.current.set(entry.id, html);
    return html;
  }, []);

  useMemo(() => {
    parseCacheRef.current = new Map<number, string>();
  }, [content]);

  const resetFilters = useCallback(() => {
    setFilters((current) => ({
      ...current,
      searchQuery: DEFAULT_CONSOLE_FILTER_STATE.searchQuery,
      logLevel: DEFAULT_CONSOLE_FILTER_STATE.logLevel,
    }));
  }, []);

  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 30,
  });

  if (content == null) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center h-full p-6 bg-bg-app', className)}
      >
        <div className="flex flex-col items-center gap-3 text-muted-ol">
          <Terminal className="h-8 w-8" />
          <p className="text-sm font-body">{t('deploy.noBuildLog')}</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center h-full p-6 bg-bg-app', className)}
      >
        <div className="flex flex-col items-center gap-3 text-muted-ol">
          <Terminal className="h-8 w-8" />
          <p className="text-sm font-body">{t('logs.emptyTitle')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-bg-app', className)}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel">
        {/* Left: Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 text-muted-ol shrink-0" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                searchQuery: e.target.value,
              }))
            }
            placeholder={CONSOLE_LABELS.searchPlaceholder}
            className={cn(
              'flex-1 bg-transparent text-xs font-mono text-primary-ol',
              'placeholder:text-muted-ol focus:outline-none',
            )}
          />
          <button
            type="button"
            title={CONSOLE_LABELS.searchMode[filters.searchMode]}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                searchMode: current.searchMode === 'regex' ? 'text' : 'regex',
              }))
            }
            className={cn(
              'px-1.5 py-0.5 rounded text-xs font-mono transition-colors',
              isRegex
                ? 'bg-agent/15 text-agent border border-agent/30'
                : 'text-muted-ol hover:text-secondary-ol border border-transparent',
            )}
          >
            .*
          </button>
          <div className="w-px h-3.5 bg-[hsl(var(--border))] mx-1" />
          <select
            value={filters.logLevel}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                logLevel: e.target.value as ConsoleLogLevelFilter,
              }))
            }
            className="bg-transparent text-xs font-mono text-muted-ol focus:outline-none border-none cursor-pointer hover:text-primary-ol appearance-none pr-2"
          >
            {Object.entries(CONSOLE_LABELS.logLevel).map(([value, label]) => (
              <option key={value} value={value} className="bg-bg-panel text-primary-ol">
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Controls & Status */}
        <div className="flex items-center gap-3">
          {/* Status Indicators */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-muted-ol">
              {hasActiveFilters ? (
                <>
                  <span className="text-primary-ol font-medium">
                    {filteredEntries.length.toLocaleString()}
                  </span>{' '}
                  / {entries.length.toLocaleString()} {CONSOLE_LABELS.lines}
                </>
              ) : (
                <>
                  {entries.length.toLocaleString()} {CONSOLE_LABELS.lines}
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto font-log text-xs leading-5 bg-bg-app">
        {filteredEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-bg-panel/60 p-5 text-center shadow-sm">
              <p className="text-sm font-body font-medium text-primary-ol">
                {t('logs.noMatchingTitle')}
              </p>
              <p className="mt-2 text-sm font-body text-muted-ol">{t('logs.noMatchingBody')}</p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-bg-subtle px-3 py-1.5 text-xs font-body text-primary-ol transition-colors hover:bg-bg-subtle/80"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('logs.clearFilters')}
                </button>
              )}
            </div>
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
              const entry = filteredEntries[virtualItem.index];
              const level = detectLevel(entry.line);

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
                    'flex items-start px-4 py-0.5 hover:bg-bg-subtle/50 group border-b border-b-transparent hover:border-b-[hsl(var(--border))]/30 transition-colors border-l-2',
                    level === 'error'
                      ? 'bg-error/10 border-l-error'
                      : level === 'warn'
                        ? 'bg-warning/10 border-l-warning'
                        : 'border-l-transparent',
                    level === 'debug' && 'opacity-60',
                    level !== 'error' &&
                      level !== 'warn' &&
                      virtualItem.index % 2 === 0 &&
                      'bg-bg-subtle/20',
                  )}
                >
                  <span className="shrink-0 w-12 text-right pr-3 text-muted-ol/40 group-hover:text-muted-ol select-none tabular-nums text-xs leading-5">
                    {entry.id + 1}
                  </span>
                  <span
                    className={cn('flex-1 whitespace-pre', levelColors[level])}
                    dangerouslySetInnerHTML={{ __html: getParsedHtml(entry) }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
