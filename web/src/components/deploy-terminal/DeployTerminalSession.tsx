import { useMemo } from 'react';
import { cn } from '@/lib/utils';

import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';
import { mergeUnifiedFeed, type UnifiedItem } from '../project/unified-feed-utils';

import { TerminalFrame } from './TerminalFrame';
import { TerminalHeader } from './TerminalHeader';
import { TerminalPhaseRail, type Phase } from './TerminalPhaseRail';
import { TerminalScrollback } from './TerminalScrollback';
import { TerminalLogBlock } from './TerminalLogBlock';
import { TerminalQuestion } from './TerminalQuestion';
import { TerminalLine } from './TerminalLine';

export interface DeployTerminalSessionProps {
  projectName: string;
  branchName?: string;
  projectStatus?: string;
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  className?: string;
}

// Helper to group consecutive log items
function groupLogs(items: UnifiedItem[]) {
  const grouped: Array<UnifiedItem | { type: 'log_group'; id: string; logs: string[] }> = [];
  let currentLogGroup: { type: 'log_group'; id: string; logs: string[] } | null = null;

  for (const item of items) {
    if (item.type === 'timeline' && item.item.type === 'log') {
      if (!currentLogGroup) {
        currentLogGroup = {
          type: 'log_group',
          id: `log-group-${item.item.id}`,
          logs: [item.item.title],
        };
        grouped.push(currentLogGroup);
      } else {
        currentLogGroup.logs.push(item.item.title);
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
  onSubmitAnswer,
  onSkipQuestion,
  className,
}: DeployTerminalSessionProps) {
  const unifiedItems = useMemo(() => mergeUnifiedFeed(timelineItems), [timelineItems]);

  const groupedItems = useMemo(() => groupLogs(unifiedItems), [unifiedItems]);

  // Derive phases from timeline items
  const phases = useMemo(() => {
    const steps = ['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'];
    const progressItems = timelineItems.filter((item) => item.type === 'progress');
    const latestProgress =
      progressItems.length > 0 ? progressItems[progressItems.length - 1] : null;

    const currentIdx = latestProgress ? steps.indexOf(latestProgress.stepName ?? '') : -1;

    return steps.map((step, i) => {
      let state: Phase['state'] = 'pending';
      if (projectStatus === 'error' && i === currentIdx) {
        state = 'error';
      } else if (i < currentIdx || (step === 'Complete' && projectStatus === 'done')) {
        state = 'done';
      } else if (i === currentIdx) {
        state = 'active';
      }
      return { id: step, label: step, state };
    });
  }, [timelineItems, projectStatus]);

  const headerStatus =
    projectStatus === 'error' ? 'error' : projectStatus === 'running' ? 'active' : 'done';

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
            <div className="flex-1 min-h-0 relative">
              <TerminalScrollback>
                <div className="p-4 flex flex-col gap-1">
                  {groupedItems.map((uItem) => {
                    if (uItem.type === 'log_group') {
                      return <TerminalLogBlock key={uItem.id} logs={uItem.logs} />;
                    }

                    if (uItem.type === 'timeline') {
                      const item = uItem.item;

                      if (item.type === 'question' && item.questionId && item.questions) {
                        const q = item.questions[0];
                        return (
                          <TerminalQuestion
                            key={item.id}
                            id={item.questionId}
                            question={q.question}
                            options={q.options.map((o) => ({
                              id: o.label,
                              label: o.label,
                              description: o.description,
                            }))}
                            answered={item.answered}
                            onSubmit={(qId, optId) => {
                              onSubmitAnswer(qId, [{ questionIndex: 0, selectedLabels: [optId] }]);
                            }}
                            onSkip={(qId) => onSkipQuestion(qId)}
                          />
                        );
                      }

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
                    }

                    return null;
                  })}

                  {isTimelineStreaming && (
                    <TerminalLine glyphState="active" textColor="muted" className="animate-pulse">
                      _
                    </TerminalLine>
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
