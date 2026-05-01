import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLogStream, type LogEntry } from '@/hooks/use-log-stream';
import { cn } from '@/lib/utils';
import { Search, ArrowDown, Trash2, Radio, RefreshCw } from 'lucide-react';
import { normalizeLogText, parseAnsiLine } from '@/lib/ansi';
import { detectLevel, levelColors } from '@/lib/log-utils';
import {
  CONSOLE_LABELS,
  DEFAULT_CONSOLE_FILTER_STATE,
  getConsoleSurfaceState,
  type ConsoleFilterState,
  type ConsoleLogLevelFilter,
} from '@/types';

function formatLogTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${Y}-${M}-${D} ${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return '';
  }
}

interface LogViewerProps {
  projectId: string;
  /** Optional service id. When set, the stream is scoped to that
   *  service's container instead of the project-level interleave —
   *  multi-service compose stacks need this to avoid mixing logs. */
  serviceId?: string;
  toolbarActions?: React.ReactNode;
}

export function LogViewer({ projectId, serviceId, toolbarActions }: LogViewerProps) {
  const { t } = useLanguage();
  const [filters, setFilters] = useState<
    Pick<ConsoleFilterState, 'searchMode' | 'searchQuery' | 'logLevel'>
  >({
    searchMode: DEFAULT_CONSOLE_FILTER_STATE.searchMode,
    searchQuery: DEFAULT_CONSOLE_FILTER_STATE.searchQuery,
    logLevel: DEFAULT_CONSOLE_FILTER_STATE.logLevel,
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const isRegex = filters.searchMode === 'regex';

  const {
    entries,
    followMode,
    isConnected,
    isInitialLoading,
    isDisconnected,
    error,
    unseenCount,
    isLoadingOlder,
    canLoadOlder,
    canJumpToLatest,
    clear,
    pauseFollowing,
    jumpToLatest,
    loadOlder,
  } = useLogStream({
    projectId,
    serviceId,
    enabled: true,
  });
  const isFollowing = followMode === 'follow';
  const hasActiveFilters = filters.searchQuery.trim().length > 0 || filters.logLevel !== 'all';

  // Filter entries by search and level
  const filteredEntries = useMemo(() => {
    let result = entries;

    if (filters.logLevel !== 'all') {
      result = result.filter((e) => {
        const level = e.stream === 'stderr' ? 'error' : detectLevel(e.line);
        return level === filters.logLevel;
      });
    }

    if (!filters.searchQuery.trim()) return result;

    try {
      if (isRegex) {
        const regex = new RegExp(filters.searchQuery, 'i');
        return result.filter((e) => regex.test(normalizeLogText(e.line)));
      }
      const lower = filters.searchQuery.toLowerCase();
      return result.filter((e) => normalizeLogText(e.line).toLowerCase().includes(lower));
    } catch {
      // Invalid regex — show all
      return result;
    }
  }, [entries, filters.searchQuery, filters.logLevel, isRegex]);

  // Memoize parsed ANSI HTML
  const parsedLines = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of filteredEntries) {
      map.set(entry.id, parseAnsiLine(entry.line));
    }
    return map;
  }, [filteredEntries]);

  const surfaceState = getConsoleSurfaceState({
    hasEntries: entries.length > 0,
    hasFilteredEntries: filteredEntries.length > 0,
    isInitialLoading,
    isDisconnected,
    hasError: Boolean(error),
  });
  const showRecoveryBanner = (Boolean(error) || isDisconnected) && filteredEntries.length > 0;

  const resetFilters = useCallback(() => {
    setFilters((current) => ({
      ...current,
      searchQuery: DEFAULT_CONSOLE_FILTER_STATE.searchQuery,
      logLevel: DEFAULT_CONSOLE_FILTER_STATE.logLevel,
    }));
  }, []);

  // Virtual list
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 30,
  });

  // Auto-scroll when following
  useEffect(() => {
    if (!isFollowing || filteredEntries.length === 0) return;
    virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
  }, [filteredEntries.length, isFollowing, virtualizer]);

  // Detect scroll up → disable follow
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (!isNearBottom && isFollowing) {
      pauseFollowing();
    }
  }, [isFollowing, pauseFollowing]);

  const scrollToBottom = useCallback(() => {
    jumpToLatest();
    if (filteredEntries.length > 0) {
      virtualizer.scrollToIndex(filteredEntries.length - 1, { align: 'end' });
    }
  }, [filteredEntries.length, jumpToLatest, virtualizer]);

  const loadOlderWithScrollAnchor = useCallback(async () => {
    const el = parentRef.current;
    const previousScrollHeight = el?.scrollHeight ?? 0;
    const previousScrollTop = el?.scrollTop ?? 0;

    await loadOlder();

    if (!el) return;

    requestAnimationFrame(() => {
      const nextScrollHeight = el.scrollHeight;
      el.scrollTop = previousScrollTop + (nextScrollHeight - previousScrollHeight);
    });
  }, [loadOlder]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel">
        {/* Left: Search */}
        <div className="flex items-center gap-1.5 flex-1 max-w-md">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
              'flex-1 bg-transparent text-xs font-mono text-foreground',
              'placeholder:text-muted-foreground focus:outline-none',
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
                : 'text-muted-foreground hover:text-foreground/80 border border-transparent',
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
            className="bg-transparent text-xs font-mono text-muted-foreground focus:outline-none border-none cursor-pointer hover:text-foreground appearance-none pr-2"
          >
            {Object.entries(CONSOLE_LABELS.logLevel).map(([value, label]) => (
              <option key={value} value={value} className="bg-bg-panel text-foreground">
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Right: Controls & Status */}
        <div className="flex items-center gap-3">
          {/* Status Indicators */}
          <div className="flex items-center gap-2 text-xs font-mono">
            {isConnected && (
              <span className="flex items-center gap-1.5 text-success">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                </span>
                {CONSOLE_LABELS.live}
              </span>
            )}
            {isInitialLoading && !isConnected && (
              <span className="text-muted-foreground">{CONSOLE_LABELS.connecting}</span>
            )}
            {isDisconnected && <span className="text-warning">{CONSOLE_LABELS.disconnected}</span>}
            <span className="text-muted-foreground border-l border-[hsl(var(--border))] pl-2">
              {hasActiveFilters ? (
                <>
                  <span className="text-foreground font-medium">
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

          <div className="w-px h-4 bg-[hsl(var(--border))]" />

          {/* Log Actions */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (isFollowing ? pauseFollowing() : scrollToBottom())}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-body transition-colors',
                isFollowing
                  ? 'bg-success/10 text-success hover:bg-success/20'
                  : 'bg-warning/10 text-warning hover:bg-warning/20',
              )}
            >
              <Radio className={cn('h-3.5 w-3.5', isFollowing && 'animate-pulse')} />
              {isFollowing ? CONSOLE_LABELS.followMode.follow : CONSOLE_LABELS.followMode.paused}
            </button>

            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-body text-muted-foreground hover:text-foreground/80 hover:bg-bg-subtle/50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {CONSOLE_LABELS.clear}
            </button>
          </div>

          {toolbarActions && (
            <>
              <div className="w-px h-4 bg-[hsl(var(--border))]" />
              {toolbarActions}
            </>
          )}
        </div>
      </div>

      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto font-log text-xs leading-5 bg-bg-panel custom-logs-scrollbar"
      >
        {showRecoveryBanner && (
          <div className="sticky top-0 z-10 border-b border-[hsl(var(--border))] bg-bg-panel/95 px-4 py-2 backdrop-blur-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className={cn('text-sm font-body', error ? 'text-error' : 'text-warning')}>
                  {error ? t('logs.errorTitle') : t('logs.disconnectedTitle')}
                </p>
                <p className="text-sm font-body text-muted-foreground">
                  {error ? error : t('logs.disconnectedInlineBody')}
                </p>
              </div>
              <button
                type="button"
                onClick={scrollToBottom}
                className="inline-flex items-center gap-1.5 self-start rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-body text-foreground/80 transition-colors hover:bg-bg-subtle hover:text-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('logs.retryStream')}
              </button>
            </div>
          </div>
        )}
        {!isFollowing && (canLoadOlder || isLoadingOlder) && (
          <div className="sticky top-0 z-10 flex justify-center px-4 py-2 bg-bg-app/95 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => void loadOlderWithScrollAnchor()}
              disabled={isLoadingOlder}
              className={cn(
                'rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs font-body transition-colors',
                isLoadingOlder
                  ? 'text-muted-foreground bg-bg-panel/60 cursor-wait'
                  : 'text-foreground/80 bg-bg-panel hover:text-foreground',
              )}
            >
              {isLoadingOlder ? CONSOLE_LABELS.loadingOlder : CONSOLE_LABELS.loadOlder}
            </button>
          </div>
        )}
        {surfaceState !== 'ready' ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-bg-panel/60 p-5 text-center shadow-sm">
              <p className="text-sm font-body font-medium text-foreground">
                {surfaceState === 'loading' && t('logs.loadingTitle')}
                {surfaceState === 'empty' && t('logs.emptyTitle')}
                {surfaceState === 'error' && t('logs.errorTitle')}
                {surfaceState === 'disconnected' && t('logs.disconnectedTitle')}
                {surfaceState === 'noMatch' && t('logs.noMatchingTitle')}
              </p>
              <p className="mt-2 text-sm font-body text-muted-foreground">
                {surfaceState === 'loading' && t('logs.loadingBody')}
                {surfaceState === 'empty' && t('logs.emptyBody')}
                {surfaceState === 'error' && (error ?? t('logs.errorBody'))}
                {surfaceState === 'disconnected' && t('logs.disconnectedBody')}
                {surfaceState === 'noMatch' && t('logs.noMatchingBody')}
              </p>
              {(surfaceState === 'error' || surfaceState === 'disconnected') && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-bg-subtle px-3 py-1.5 text-xs font-body text-foreground transition-colors hover:bg-bg-subtle/80"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t('logs.retryStream')}
                </button>
              )}
              {surfaceState === 'noMatch' && hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-bg-subtle px-3 py-1.5 text-xs font-body text-foreground transition-colors hover:bg-bg-subtle/80"
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
                    'flex items-start px-4 py-0.5 hover:bg-bg-subtle/50 group border-b border-b-transparent hover:border-b-[hsl(var(--border))]/30 transition-colors border-l-2',
                    level === 'error'
                      ? 'bg-error/10 border-l-error'
                      : level === 'warn'
                        ? 'bg-warning/10 border-l-warning'
                        : 'border-l-transparent',
                    level === 'debug' && 'opacity-60',
                    level !== 'error' &&
                      level !== 'warn' &&
                      entry.stream === 'stderr' &&
                      'bg-error/[0.03]',
                    level !== 'error' &&
                      level !== 'warn' &&
                      virtualItem.index % 2 === 0 &&
                      'bg-bg-subtle',
                  )}
                >
                  {/* Line number */}
                  <span className="shrink-0 w-12 text-right pr-3 text-muted-foreground/40 group-hover:text-muted-foreground select-none tabular-nums text-xs leading-5">
                    {virtualItem.index + 1}
                  </span>
                  {/* Timestamp */}
                  {entry.time && (
                    <span className="shrink-0 pr-3 text-muted-foreground/50 group-hover:text-muted-foreground/70 select-none tabular-nums text-xs leading-5 font-mono">
                      {formatLogTime(entry.time)}
                    </span>
                  )}
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
      {canJumpToLatest && filteredEntries.length > 0 && (
        <div className="absolute bottom-6 right-6 z-10 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={scrollToBottom}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-full shadow-md transition-all duration-200',
              unseenCount > 0
                ? 'bg-foreground text-primary-foreground font-medium hover:shadow-lg'
                : 'bg-bg-panel border border-[hsl(var(--border))] text-foreground/80 hover:text-foreground hover:bg-bg-subtle',
            )}
          >
            <ArrowDown className={cn('h-4 w-4', unseenCount > 0 && 'animate-bounce')} />
            <span className="text-sm">
              {unseenCount > 0
                ? `${CONSOLE_LABELS.jumpToLatest} (${unseenCount})`
                : CONSOLE_LABELS.jumpToLatest}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
