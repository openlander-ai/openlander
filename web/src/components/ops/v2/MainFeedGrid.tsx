import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo, useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Clock, AlertCircle, FileText } from 'lucide-react';
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

const THREADS_PAGE_SIZE = 40;
const EVENTS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Title localisation helper
// ---------------------------------------------------------------------------

const TITLE_PATTERNS: [RegExp, string][] = [
  [/^Auto-recovery running$/i, 'opsV2.titles.autoRecoveryRunning'],
  [/^Auto-recovery failed/i, 'opsV2.titles.autoRecoveryFailed'],
  [/^Auto-recovery succeeded$/i, 'opsV2.titles.autoRecoveryCompleted'],
  [/^Auto-recovery attempt/i, 'opsV2.titles.autoRecoveryRunning'],
  [/^Auto-recovery exhausted$/i, 'opsV2.titles.autoRecoveryFailed'],
  [/^Incident detected$/i, 'opsV2.titles.incidentDetected'],
  [/^Health check failed/i, 'opsV2.titles.healthCheckFailed'],
  [/^Health degraded$/i, 'opsV2.titles.healthCheckFailed'],
  [/^Deploy crashed$/i, 'opsV2.titles.deployCrash'],
  [/^Deploy failed/i, 'opsV2.titles.deployFailed'],
  [/^Compose failed$/i, 'opsV2.titles.deployFailed'],
  [/^Circuit breaker open/i, 'opsV2.titles.circuitBreakerOpen'],
  [/^Circuit breaker reset/i, 'opsV2.titles.circuitBreakerReset'],
];

function localizeTitle(title: string, t: (key: string) => string): string {
  for (const [pattern, key] of TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return t(key);
    }
  }
  return humanizeEventType(title, t);
}

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
  triggerType?: string;
  title?: string;
}

export interface MainFeedGridProps {
  activities: ActivityItem[];
  onThreadSelect?: (correlationId: string) => void;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

function eventCategory(type: string): string {
  if (
    type === 'recovery' ||
    type === 'approval' ||
    type === 'incident' ||
    type === 'recovery:blocked' ||
    type === 'recovery:stopped' ||
    type === 'recovery:started'
  ) {
    return 'recovery';
  }
  if (type === 'deploy' || type === 'build') {
    return 'deploy';
  }
  return type;
}

function groupIntoThreads(
  items: ActivityItem[],
  t: (key: string) => string,
): Omit<Thread, 'isExpanded'>[] {
  const threadMap = new Map<string, ActivityItem[]>();
  const orderKeys: string[] = [];

  for (const item of items) {
    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    const category = eventCategory(item.type);
    const key = item.correlationId || `${item.projectId}::${category}::${tsBucket}`;

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

    // Try to find a meaningful title
    const activeIncident = events.find((e) => e.type === 'incident');
    const title = activeIncident?.title || head.title || humanizeEventType(head.type, t);
    const triggerType = activeIncident?.triggerType;

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
      title,
      triggerType,
    });
  }

  // Sort threads: newest first by most recent event
  threads.sort((a, b) => new Date(b.lastEventTime).getTime() - new Date(a.lastEventTime).getTime());

  return threads;
}

// ---------------------------------------------------------------------------
// Layout Grid Definitions
// ---------------------------------------------------------------------------
// Density approach: standard table rows using CSS grid.
const ROW_GRID_CLASSES =
  'grid grid-cols-[24px_minmax(140px,1.8fr)_minmax(200px,3fr)_80px_100px_60px_100px] items-center gap-3 px-3';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ThreadEventDenseRow = memo(function ThreadEventDenseRow({ event }: { event: ActivityItem }) {
  const { t, language } = useLanguage();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const isAiEvent = event.type.startsWith('ai:') || event.type === 'ai_diagnosis';
  const hasDetails = !!event.description || !!event.aiMetadata?.diagnosisSummary;

  const rawTitle =
    event.title || humanizeEventType(event.type, t as unknown as (key: string) => string);
  const titleText = localizeTitle(rawTitle, t as unknown as (key: string) => string);

  return (
    <div className="flex flex-col border-b border-[hsl(var(--border))]/30 last:border-0 hover:bg-bg-subtle/30 transition-colors">
      <div className={cn(ROW_GRID_CLASSES, 'py-1.5 text-[11px]')}>
        {/* Empty left gap for alignment with parent chevron */}
        <div className="flex justify-end">
          <div
            className={cn('h-1.5 w-1.5 rounded-full mr-2', isAiEvent ? 'bg-agent' : 'bg-muted-ol')}
          />
        </div>

        {/* Time */}
        <div className="text-muted-ol whitespace-nowrap">
          {new Date(event.timestamp).toLocaleTimeString(language, {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>

        {/* Event Name & Expand Toggle */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn('truncate font-medium', isAiEvent ? 'text-agent' : 'text-primary-ol')}
            title={titleText}
          >
            {titleText}
          </span>
          {hasDetails && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(!detailsOpen);
              }}
              className="shrink-0 inline-flex items-center gap-1 bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] rounded px-1.5 py-0.5 text-[9px] text-muted-ol font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-agent"
            >
              <FileText className="w-3 h-3" />
              {detailsOpen ? t('opsV2.timeline.detailsHide') : t('opsV2.timeline.detailsShow')}
            </button>
          )}
        </div>

        {/* Severity */}
        <div>
          <SeverityBadge severity={event.severity} />
        </div>

        {/* Status */}
        <div className="truncate text-muted-ol">{t(`opsV2.status.${event.status}`)}</div>

        {/* Actions empty cell */}
        <div />

        {/* Metadata */}
        <div className="text-muted-ol text-[10px] truncate">
          {event.aiMetadata?.model && <span>{event.aiMetadata.model} </span>}
          {event.aiMetadata?.durationMs && (
            <span>({(event.aiMetadata.durationMs / 1000).toFixed(1)}s)</span>
          )}
        </div>
      </div>

      {/* Inline Details Expansion */}
      {detailsOpen && hasDetails && (
        <div className="pl-[165px] pr-4 pb-2 pt-1 animate-in fade-in slide-in-from-top-1">
          {event.aiMetadata?.diagnosisSummary && (
            <div className="mt-0.5 mb-1.5 p-2 bg-agent/5 border border-agent/20 rounded-md">
              <p className="text-[10px] font-semibold text-agent mb-1 uppercase tracking-wider">
                {t('ops.aiDiagnosisSummary')}
              </p>
              <p className="text-[11px] text-primary-ol leading-relaxed">
                {event.aiMetadata.diagnosisSummary}
              </p>
            </div>
          )}

          {event.description && (
            <div className="w-full overflow-hidden mt-0.5">
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[11px] text-secondary-ol prose-p:text-[11px] prose-p:leading-relaxed prose-headings:text-primary-ol prose-headings:text-xs prose-headings:font-semibold prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/50 prose-pre:text-[11px] prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{event.description}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MainFeedGrid({ activities, onThreadSelect }: MainFeedGridProps) {
  const { t, language } = useLanguage();

  const threadData = useMemo(() => {
    const threads = groupIntoThreads(activities, t as unknown as (key: string) => string);
    // Pin threads with pending approvals to the top
    return [
      ...threads.filter((th) => th.hasPendingApproval),
      ...threads.filter((th) => !th.hasPendingApproval),
    ];
  }, [activities, t]);

  const [visibleThreadCount, setVisibleThreadCount] = useState(THREADS_PAGE_SIZE);
  const [expandedEventsMap, setExpandedEventsMap] = useState<Record<string, number>>({});
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
      <div className="flex flex-col items-center justify-center py-16 text-center border rounded border-dashed border-[hsl(var(--border))]">
        <Clock className="mb-3 h-8 w-8 text-muted-ol/50" />
        <p className="text-sm text-muted-ol">{t('opsV2.empty.noActivity')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" role="table" aria-label={t('opsV2.timeline.eventLog')}>
      {/* List Header */}
      <div className="flex justify-between items-center mb-2 px-1">
        <h2 className="text-sm font-semibold text-primary-ol">{t('opsV2.timeline.eventLog')}</h2>
        <button
          type="button"
          onClick={toggleAll}
          className="text-[11px] bg-bg-panel hover:bg-bg-subtle border border-[hsl(var(--border))] px-2 py-1 flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-agent text-secondary-ol font-medium transition-colors rounded shadow-sm"
        >
          {allExpanded ? t('opsV2.timeline.collapseAll') : t('opsV2.timeline.expandAll')}
        </button>
      </div>

      {/* Grid Table Header */}
      <div
        role="row"
        className={cn(
          ROW_GRID_CLASSES,
          'bg-bg-panel border-y border-[hsl(var(--border))] py-2',
          'text-[10px] font-mono tracking-wider uppercase font-semibold text-muted-ol',
        )}
      >
        <div role="columnheader" /> {/* expander col */}
        <div role="columnheader">{t('opsV2.timeline.columns.projectTarget')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.detectedEvent')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.severity')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.state')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.eventCount')}</div>
        <div role="columnheader">{t('opsV2.timeline.columns.latest')}</div>
      </div>

      {/* Body Rows */}
      <div className="flex flex-col bg-app border-b border-[hsl(var(--border))]" role="rowgroup">
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
                'group border-b border-[hsl(var(--border))]/50 last:border-0 transition-colors',
                isCritical && 'bg-error/5',
                isWarning && !isCritical && 'bg-warning/5',
              )}
            >
              {/* Parent Row */}
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  role="row"
                  className={cn(
                    ROW_GRID_CLASSES,
                    'w-full py-2 hover:bg-bg-subtle/80 transition-colors text-left outline-none focus-visible:bg-bg-subtle',
                    isExpanded && 'bg-bg-subtle/40',
                  )}
                >
                  <span role="cell" className="shrink-0 text-muted-ol">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>

                  <span
                    role="cell"
                    className="min-w-0 shrink truncate text-xs font-semibold text-primary-ol"
                  >
                    {thread.projectName}
                  </span>

                  <div role="cell" className="min-w-0 flex flex-col justify-center">
                    <span
                      className="truncate text-xs font-medium text-secondary-ol"
                      title={
                        thread.title
                          ? localizeTitle(thread.title, t as unknown as (key: string) => string)
                          : undefined
                      }
                    >
                      {thread.title
                        ? localizeTitle(thread.title, t as unknown as (key: string) => string)
                        : thread.title}
                    </span>
                    {thread.triggerType && (
                      <span className="truncate text-[10px] font-mono text-muted-ol mt-0.5">
                        {humanizeEventType(
                          thread.triggerType,
                          t as unknown as (key: string) => string,
                        )}
                      </span>
                    )}
                  </div>

                  <div role="cell">
                    <SeverityBadge severity={thread.severity} />
                  </div>

                  <div role="cell" className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-[11px] font-medium',
                        thread.status === 'active' && 'text-warning',
                        thread.status === 'resolved' && 'text-success',
                        thread.status === 'failed' && 'text-error',
                        thread.status === 'pending' && 'text-info',
                        thread.status === 'recovering' && 'text-info',
                        thread.status === 'ai-running' && 'text-agent',
                        thread.status === 'ai-completed' && 'text-info',
                        thread.status === 'recovery-blocked' && 'text-warning',
                        thread.status === 'recovery-stopped' && 'text-warning',
                      )}
                    >
                      {t(`opsV2.status.${thread.status}`)}
                    </span>
                    {thread.hasPendingApproval && (
                      <AlertCircle className="h-3.5 w-3.5 text-warning animate-pulse" />
                    )}
                  </div>

                  <span role="cell" className="text-[11px] text-muted-ol font-mono">
                    {thread.eventCount}
                  </span>

                  <span role="cell" className="text-[11px] text-muted-ol">
                    {relativeTime(new Date(thread.lastEventTime).getTime(), language)}
                  </span>
                </button>
              </CollapsibleTrigger>

              {/* Child Events Section */}
              <CollapsibleContent>
                <div className="bg-bg-panel/20 shadow-inner">
                  {visibleEvents.map((event) => (
                    <ThreadEventDenseRow key={event.id} event={event} />
                  ))}

                  {/* Load more within thread */}
                  {hiddenEventCount > 0 && (
                    <div className="px-10 py-2 border-b border-[hsl(var(--border))]/30">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          showMoreEvents(thread.correlationId);
                        }}
                        className="text-[11px] text-primary-ol hover:text-agent transition-colors font-medium border border-[hsl(var(--border))] rounded px-2 py-1 bg-bg-panel hover:bg-bg-subtle"
                      >
                        {t('opsV2.timeline.showOlderEvents')} ({hiddenEventCount})
                      </button>
                    </div>
                  )}

                  {/* Approvals Block */}
                  {thread.hasPendingApproval && (
                    <div className="pl-10 pr-4 py-3 border-b border-[hsl(var(--border))]/30 bg-warning/5">
                      <ThreadApprovalActions events={thread.events} />
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>

      {threadData.length > visibleThreadCount && (
        <button
          type="button"
          onClick={() => setVisibleThreadCount((n) => n + THREADS_PAGE_SIZE)}
          className={cn(
            'mt-4 w-full rounded-md border border-dashed border-[hsl(var(--border))] bg-bg-panel',
            'py-2.5 text-[11px] font-medium text-muted-ol hover:text-primary-ol hover:border-primary-ol/40 hover:bg-bg-subtle',
            'transition-colors focus:outline-none focus:ring-1 focus:ring-agent shadow-sm',
          )}
        >
          {t('opsV2.timeline.showOlderEvents')} ({threadData.length - visibleThreadCount})
        </button>
      )}
    </div>
  );
}
