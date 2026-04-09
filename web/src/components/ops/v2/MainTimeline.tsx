import { useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Clock, AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { ActivityItem } from '../../../lib/api/operations.js';
import { SeverityBadge } from '../SeverityBadge.js';
import { relativeTime, humanizeEventType } from '../utils.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible.js';
import { ThreadApprovalActions } from './ThreadApprovalActions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREADS_PAGE_SIZE = 20;
const EVENTS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Thread {
  correlationId: string;
  projectId: string;
  projectName: string;
  severity: string;
  status: string;
  hasPendingApproval: boolean;
  lastEventTime: string;
  eventCount: number;
  events: ActivityItem[];
  isExpanded: boolean;
}

export interface MainTimelineProps {
  activities: ActivityItem[];
  onThreadSelect?: (correlationId: string) => void;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

function groupIntoThreads(items: ActivityItem[]): Omit<Thread, 'isExpanded'>[] {
  const threadMap = new Map<string, ActivityItem[]>();
  const orderKeys: string[] = [];

  for (const item of items) {
    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    const key = item.correlationId || `${item.projectId}::${item.type}::${tsBucket}`;

    const existing = threadMap.get(key);
    if (existing) {
      existing.push(item);
    } else {
      threadMap.set(key, [item]);
      orderKeys.push(key);
    }
  }

  const threads: Omit<Thread, 'isExpanded'>[] = [];

  for (const key of orderKeys) {
    const events = threadMap.get(key)!;
    // Sort events within thread: newest first
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const head = events[0];
    const hasPendingApproval = events.some((e) => e.type === 'approval' && e.status === 'pending');

    // Severity: pick the most severe across all events in the thread
    const severityRank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    let maxSeverity = head.severity;
    for (const e of events) {
      if ((severityRank[e.severity] ?? 0) > (severityRank[maxSeverity] ?? 0)) {
        maxSeverity = e.severity;
      }
    }

    threads.push({
      correlationId: key,
      projectId: head.projectId,
      projectName: head.projectName,
      severity: maxSeverity,
      status: head.status,
      hasPendingApproval,
      lastEventTime: head.timestamp,
      eventCount: events.length,
      events,
    });
  }

  // Sort threads: newest first by most recent event
  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());

  return threads;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ThreadEventRow({ event }: { event: ActivityItem }) {
  const { t, language } = useLanguage();

  return (
    <div className="relative flex items-start gap-3 py-2">
      <div className="absolute -left-[17px] top-3.5 h-1.5 w-1.5 rounded-full bg-agent" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-primary-ol">
            {humanizeEventType(event.type, t as unknown as (key: string) => string)}
          </span>
          <span className="text-muted-ol">
            {relativeTime(new Date(event.timestamp).getTime(), language)}
          </span>
        </div>
        {event.description && (
          <p className="truncate text-xs text-secondary-ol">{event.description}</p>
        )}
      </div>
      <SeverityBadge severity={event.severity} className="shrink-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainTimeline({ activities, onThreadSelect }: MainTimelineProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities]);

  // Progressive disclosure: how many threads are visible
  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);

  // Per-thread event page: tracks how many events are visible per thread
  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});

  // Default: auto-expand threads with pending approvals; collapse everything else
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const th of threadData) {
      initial[th.correlationId] = th.hasPendingApproval;
    }
    return initial;
  });

  const allExpanded =
    threadData.length > 0 && threadData.every((th) => !!expandedMap[th.correlationId]);

  const toggleAll = useCallback(() => {
    const next = !allExpanded;
    setExpandedMap(() => {
      const map: Record<string, boolean> = {};
      for (const th of threadData) {
        map[th.correlationId] = next;
      }
      return map;
    });
  }, [allExpanded, threadData]);

  const toggleThread = useCallback(
    (correlationId: string) => {
      setExpandedMap((prev) => ({ ...prev, [correlationId]: !prev[correlationId] }));
      onThreadSelect?.(correlationId);
    },
    [onThreadSelect],
  );

  const showMoreEvents = useCallback((correlationId: string) => {
    setExpandedEventsMap((prev) => ({
      ...prev,
      [correlationId]: (prev[correlationId] ?? EVENTS_PAGE_SIZE) + EVENTS_PAGE_SIZE,
    }));
  }, []);

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Clock className="mb-3 h-8 w-8 text-muted-ol" />
        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivity')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Expand all / Collapse all */}
      <div className="flex justify-end pb-1">
        <button
          type="button"
          onClick={toggleAll}
          className={cn(
            'text-[11px] text-muted-ol hover:text-primary-ol transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent rounded',
          )}
        >
          {allExpanded ? t('opsV2.timeline.collapseAll') : t('opsV2.timeline.expandAll')}
        </button>
      </div>

      {threadData.slice(0, visibleThreadCount).map((thread) => {
        const isExpanded = !!expandedMap[thread.correlationId];
        const isCritical = thread.severity === 'critical';
        const isWarning = thread.severity === 'warning';
        const maxVisibleEvents = expandedEventsMap[thread.correlationId] ?? EVENTS_PAGE_SIZE;
        const visibleEvents = thread.events.slice(0, maxVisibleEvents);
        const hiddenEventCount = thread.events.length - visibleEvents.length;

        return (
          <Collapsible
            key={thread.correlationId}
            open={isExpanded}
            onOpenChange={() => toggleThread(thread.correlationId)}
            className={cn(
              'rounded-lg border transition-colors',
              'border-[hsl(var(--border))]',
              isCritical && 'border-l-4 border-l-error',
              isWarning && !isCritical && 'border-l-4 border-l-warning',
              !isCritical && !isWarning && 'border-l-4 border-l-transparent',
            )}
          >
            {/* Thread header row — acts as the collapsible trigger */}
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left',
                  'hover:bg-bg-subtle/50 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent',
                )}
              >
                {/* Expand/collapse chevron */}
                <span className="shrink-0 text-muted-ol">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>

                {/* Project name */}
                <span className="min-w-0 shrink truncate text-xs font-medium text-primary-ol">
                  {thread.projectName}
                </span>

                {/* Severity badge */}
                <SeverityBadge severity={thread.severity} className="shrink-0" />

                {/* Status */}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                    thread.status === 'active' && 'bg-warning/10 text-warning',
                    thread.status === 'resolved' && 'bg-success/10 text-success',
                    thread.status === 'failed' && 'bg-error/10 text-error',
                    thread.status === 'pending' && 'bg-info/10 text-info',
                    thread.status === 'recovering' && 'bg-info/10 text-info',
                    thread.status === 'ai-running' && 'bg-agent/10 text-agent',
                    thread.status === 'ai-completed' && 'bg-info/10 text-info',
                    thread.status === 'recovery-blocked' && 'bg-warning/10 text-warning',
                    thread.status === 'recovery-stopped' && 'bg-warning/10 text-warning',
                  )}
                >
                  {thread.status.replace(/-/g, ' ')}
                </span>

                {/* Pending approval indicator */}
                {thread.hasPendingApproval && (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-warning">
                    <AlertCircle className="h-3 w-3" />
                    {t('opsV2.statusStrip.approvalCount', { count: 1 })}
                  </span>
                )}

                {/* Spacer */}
                <span className="flex-1" />

                {/* Event count */}
                <span className="shrink-0 text-[10px] text-muted-ol">
                  {t('opsV2.timeline.eventCount', { count: String(thread.eventCount) })}
                </span>

                {/* Last event time */}
                <span className="shrink-0 text-[10px] text-muted-ol">
                  {relativeTime(new Date(thread.lastEventTime).getTime(), language)}
                </span>
              </button>
            </CollapsibleTrigger>

            {/* Expanded: event history with progressive disclosure for 50+ events */}
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
              <div className="border-t border-[hsl(var(--border))] bg-bg-panel/50 px-4 py-3">
                <div className="relative border-l-2 border-border/50 pl-4">
                  {visibleEvents.map((event) => (
                    <ThreadEventRow key={event.id} event={event} />
                  ))}
                  {hiddenEventCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        showMoreEvents(thread.correlationId);
                      }}
                      className="mt-2 text-[11px] text-muted-ol hover:text-primary-ol transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent rounded"
                    >
                      {t('opsV2.timeline.showOlderEvents')} ({hiddenEventCount})
                    </button>
                  )}
                </div>
                {thread.hasPendingApproval && <ThreadApprovalActions events={thread.events} />}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      {/* Thread-level progressive disclosure */}
      {threadData.length > visibleThreadCount && (
        <button
          type="button"
          onClick={() => setVisibleThreadCount((n) => n + THREADS_PAGE_SIZE)}
          className={cn(
            'mt-2 w-full rounded-lg border border-dashed border-[hsl(var(--border))]',
            'py-2.5 text-xs text-muted-ol hover:text-primary-ol hover:border-primary-ol/30',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-agent',
          )}
        >
          {t('opsV2.timeline.showOlderEvents')} ({threadData.length - visibleThreadCount})
        </button>
      )}
    </div>
  );
}
