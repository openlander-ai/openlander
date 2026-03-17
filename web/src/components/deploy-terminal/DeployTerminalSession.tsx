import { useMemo } from 'react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

import type { TimelineItem } from '@/lib/event-types';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

import { ChatInput } from '@/components/assistant/ChatInput';
import { mergeUnifiedFeed, type UnifiedItem } from '../project/unified-feed-utils';

import { TerminalFrame } from './TerminalFrame';
import { TerminalHeader } from './TerminalHeader';
import { TerminalPhaseRail, type Phase } from './TerminalPhaseRail';
import { TerminalScrollback } from './TerminalScrollback';
import { TerminalStepGroup } from './TerminalStepGroup';
import { TerminalLogBlock } from './TerminalLogBlock';
import { TerminalQuestion } from './TerminalQuestion';
import { TerminalLine } from './TerminalLine';
import { terminalTokens } from './terminal-tokens';

export interface DeployTerminalSessionProps {
  projectName: string;
  branchName?: string;
  projectStatus?: string;
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  assistantItems: AssistantItem[];
  isAssistantStreaming: boolean;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onSendMessage: (message: string) => void;
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
  assistantItems,
  isAssistantStreaming,
  onSubmitAnswer,
  onSkipQuestion,
  onSendMessage,
  className,
}: DeployTerminalSessionProps) {
  const { language } = useLanguage();

  const unifiedItems = useMemo(
    () => mergeUnifiedFeed(timelineItems, assistantItems),
    [timelineItems, assistantItems],
  );

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
                  {groupedItems.map((uItem, index) => {
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

                      if (item.type === 'agent_tool_call') {
                        return (
                          <TerminalLine key={item.id} glyphState="pending" textColor="muted">
                            ▸ {item.toolName ?? item.title}
                          </TerminalLine>
                        );
                      }

                      if (item.type === 'agent_tool_result') {
                        const ok = !item.title?.toLowerCase().includes('fail');
                        return (
                          <TerminalLine
                            key={item.id}
                            glyphState={ok ? 'done' : 'error'}
                            textColor={ok ? 'secondary' : 'error'}
                          >
                            {item.toolName ?? item.title}
                          </TerminalLine>
                        );
                      }

                      if (item.type === 'agent_message') {
                        return (
                          <TerminalLine key={item.id} glyphState="active" textColor="primary">
                            {item.detail || item.title}
                          </TerminalLine>
                        );
                      }

                      if (item.type === 'agent_thinking') {
                        const isLatest = index === groupedItems.length - 1 && isTimelineStreaming;
                        if (!isLatest) return null;
                        return (
                          <TerminalLine
                            key={item.id}
                            glyphState="active"
                            textColor="muted"
                            className="italic"
                          >
                            ...
                          </TerminalLine>
                        );
                      }

                      return (
                        <TerminalLine key={item.id} glyphState="pending" textColor="secondary">
                          {item.title}
                        </TerminalLine>
                      );
                    }

                    if (uItem.type === 'assistant_group') {
                      return (
                        <TerminalStepGroup
                          key={uItem.id}
                          title={`Tool Calls (${uItem.items.length})`}
                          defaultExpanded={false}
                        >
                          {uItem.items.map((toolItem) => (
                            <TerminalLine
                              key={toolItem.id}
                              glyphState="pending"
                              textColor="muted"
                              className="pl-4"
                            >
                              {toolItem.type === 'tool_call'
                                ? `▸ ${toolItem.toolName}`
                                : `✓ ${toolItem.toolName}`}
                            </TerminalLine>
                          ))}
                        </TerminalStepGroup>
                      );
                    }

                    const item = uItem.item;

                    if (item.type === 'needs_user_action') {
                      return (
                        <TerminalLine key={item.id} glyphState="error" textColor="error">
                          [{item.category || 'Action Required'}] {item.content}
                          {item.detail && <div className="opacity-70 mt-1">{item.detail}</div>}
                        </TerminalLine>
                      );
                    }

                    if (item.type === 'thinking') {
                      const lastThinkingId = [...assistantItems]
                        .reverse()
                        .find((i) => i.type === 'thinking')?.id;
                      if (!isAssistantStreaming || item.id !== lastThinkingId) return null;
                      return (
                        <TerminalLine
                          key={item.id}
                          glyphState="active"
                          textColor="muted"
                          className="italic"
                        >
                          ...
                        </TerminalLine>
                      );
                    }

                    if (item.type === 'question' && item.questions && item.questionId) {
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
                          {item.content}
                        </TerminalLine>
                      );
                    }

                    const isUser = item.role === 'user';
                    return (
                      <TerminalLine
                        key={item.id}
                        glyphState={isUser ? 'done' : 'active'}
                        textColor={isUser ? 'primary' : 'secondary'}
                      >
                        {isUser ? '> ' : ''}
                        {item.content}
                      </TerminalLine>
                    );
                  })}

                  {(isTimelineStreaming || isAssistantStreaming) && (
                    <TerminalLine glyphState="active" textColor="muted" className="animate-pulse">
                      _
                    </TerminalLine>
                  )}
                </div>
              </TerminalScrollback>
            </div>

            <div
              className="shrink-0 border-t p-2"
              style={{
                borderColor: terminalTokens.colors.border,
                backgroundColor: terminalTokens.colors.surface,
              }}
            >
              <ChatInput
                onSend={onSendMessage}
                disabled={isAssistantStreaming}
                placeholder={language === 'ko' ? '명령어 입력...' : 'Type a command...'}
              />
            </div>
          </div>
        </div>
      </div>
    </TerminalFrame>
  );
}
