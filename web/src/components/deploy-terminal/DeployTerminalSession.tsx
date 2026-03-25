import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Square, AlertTriangle } from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { useLanguage } from '@/i18n/context';

import type { TimelineItem } from '@/lib/event-types';
import { filterRecoveryEvents } from '@/lib/event-types';

import { TerminalFrame } from './TerminalFrame';
import { TerminalHeader } from './TerminalHeader';
import { TerminalPhaseRail, type Phase } from './TerminalPhaseRail';
import { TerminalScrollback } from './TerminalScrollback';
import { TerminalLogBlock } from './TerminalLogBlock';
import { TerminalLine } from './TerminalLine';

export interface DeployTerminalSessionProps {
  projectName: string;
  branchName?: string;
  projectStatus?: string;
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  streamDisconnected?: boolean;
  className?: string;
}

type GroupedItem = TimelineItem | { kind: 'log_group'; id: string; logs: string[] };

function isLogGroup(item: GroupedItem): item is { kind: 'log_group'; id: string; logs: string[] } {
  return 'kind' in item;
}

function groupLogs(items: TimelineItem[]): GroupedItem[] {
  const grouped: GroupedItem[] = [];
  let currentLogGroup: { kind: 'log_group'; id: string; logs: string[] } | null = null;

  for (const item of items) {
    if (item.type === 'log') {
      if (!currentLogGroup) {
        currentLogGroup = {
          kind: 'log_group',
          id: `log-group-${item.id}`,
          logs: [item.title],
        };
        grouped.push(currentLogGroup);
      } else {
        currentLogGroup.logs.push(item.title);
      }
    } else {
      currentLogGroup = null;
      grouped.push(item);
    }
  }

  return grouped;
}

export function DeployTerminalSession({
  projectName,
  branchName,
  projectStatus,
  timelineItems,
  isTimelineStreaming,
  streamDisconnected,
  className,
}: DeployTerminalSessionProps) {
  const { t } = useLanguage();
  const filteredItems = useMemo(() => filterRecoveryEvents(timelineItems), [timelineItems]);
  const groupedItems = useMemo(() => groupLogs(filteredItems), [filteredItems]);

  const phases = useMemo(() => {
    const steps = ['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'];

    const typeToStep: Record<string, string> = {
      status: 'Preparing',
      progress: 'Preparing',
      complete: 'Complete',
      error: '',
    };

    let currentIdx = -1;

    for (const item of filteredItems) {
      const stepFromName = item.stepName ? steps.indexOf(item.stepName) : -1;
      if (stepFromName > currentIdx) {
        currentIdx = stepFromName;
        continue;
      }

      const stepFromType = typeToStep[item.type];
      if (stepFromType) {
        const idx = steps.indexOf(stepFromType);
        if (idx > currentIdx) currentIdx = idx;
      }

      if (item.percent != null && item.percent >= 0) {
        const estimated =
          item.percent < 15
            ? 0
            : item.percent < 60
              ? 1
              : item.percent < 85
                ? 2
                : item.percent < 95
                  ? 3
                  : item.percent < 100
                    ? 4
                    : 5;
        if (estimated > currentIdx) currentIdx = estimated;
      }
    }

    const isRunning = projectStatus === 'running';
    if (isRunning && currentIdx < steps.length - 1) {
      currentIdx = steps.length - 1;
    }

    return steps.map((step, i) => {
      let state: Phase['state'] = 'pending';
      if (projectStatus === 'error' && i === currentIdx) {
        state = 'error';
      } else if (i < currentIdx || (step === 'Complete' && isRunning)) {
        state = 'done';
      } else if (i === currentIdx) {
        state = isRunning ? 'done' : 'active';
      }
      return { id: step, label: step, state };
    });
  }, [filteredItems, projectStatus]);

  const headerStatus =
    projectStatus === 'error' ? 'error' : projectStatus === 'running' ? 'active' : 'done';

  const isBuilding = isTimelineStreaming || projectStatus === 'building';
  const showIdleSummary = !isBuilding && filteredItems.length < 5;
  const lastItem = filteredItems[filteredItems.length - 1];
  const relativeTime = lastItem ? formatRelativeTime(lastItem.timestamp) : '';
  const isError = projectStatus === 'error';
  const isStopped = projectStatus === 'stopped';

  return (
    <TerminalFrame className={cn('h-full', className)} title="Deploy Terminal">
      <div className="flex flex-col h-full" data-testid="deploy-terminal-session">
        <TerminalHeader
          projectName={projectName}
          branchName={branchName}
          status={headerStatus}
          subtitle={projectStatus?.toUpperCase()}
        />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <TerminalPhaseRail phases={phases} className="hidden md:flex" />

          <div className="flex-1 flex flex-col min-w-0">
            {streamDisconnected && !isTimelineStreaming && (
              <div className="mx-4 mt-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-body text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('logs.streamDisconnected')}</span>
                </div>
              </div>
            )}
            <div className="flex-1 min-h-0 relative">
              <TerminalScrollback>
                <div className="p-4 flex flex-col gap-1">
                  {groupedItems.map((uItem) => {
                    if (isLogGroup(uItem)) {
                      return <TerminalLogBlock key={uItem.id} logs={uItem.logs} />;
                    }

                    const item = uItem;

                    if (item.type === 'error') {
                      return (
                        <TerminalLine key={item.id} glyphState="error" textColor="error">
                          {item.title}
                          {item.detail && <div className="opacity-70 mt-1">{item.detail}</div>}
                        </TerminalLine>
                      );
                    }

                    if (item.type === 'success') {
                      return (
                        <TerminalLine key={item.id} glyphState="done" textColor="primary">
                          {item.title}
                          {item.url && (
                            <span className="ml-2 text-blue-400 underline">{item.url}</span>
                          )}
                        </TerminalLine>
                      );
                    }

                    return (
                      <TerminalLine key={item.id} glyphState="pending" textColor="secondary">
                        {item.title}
                      </TerminalLine>
                    );
                  })}

                  {isTimelineStreaming && (
                    <TerminalLine glyphState="active" textColor="muted" className="animate-pulse">
                      _
                    </TerminalLine>
                  )}

                  {showIdleSummary && (
                    <div className="flex flex-col items-center justify-center py-8 text-center gap-2 mt-4">
                      {isError ? (
                        <XCircle className="h-8 w-8 text-error/50" />
                      ) : isStopped ? (
                        <Square className="h-8 w-8 text-muted-ol/50" />
                      ) : (
                        <CheckCircle2 className="h-8 w-8 text-success/50" />
                      )}
                      <p className="text-sm text-muted-ol">
                        {isError
                          ? 'Deployment failed'
                          : isStopped
                            ? 'Container stopped'
                            : 'All stages completed'}
                      </p>
                      <p className="text-xs text-muted-ol/60">
                        {isError
                          ? 'Check logs for details'
                          : isStopped
                            ? 'Not running'
                            : 'Container running'}
                        {relativeTime && ` • Last deploy ${relativeTime}`}
                      </p>
                    </div>
                  )}
                </div>
              </TerminalScrollback>
            </div>
          </div>
        </div>
      </div>
    </TerminalFrame>
  );
}
