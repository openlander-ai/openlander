import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

import type { TimelineItem } from '@/lib/event-types';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

import { ChatInput } from '@/components/assistant/ChatInput';
import { UserActionCard } from '@/components/assistant/UserActionCard';
import { InputRequestCard } from '@/components/timeline/InputRequestCard';
import { CollapsedToolGroup } from '@/components/assistant/ToolCallGroup';
import { mergeUnifiedFeed } from './unified-feed-utils';

interface UnifiedBriefingFeedProps {
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  projectStatus?: string;
  fixingItemId?: string | null;
  onFixWithAI?: (errorMessage?: string, timelineItemId?: string) => void;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onInsightAction: (projectId: string, action: string) => Promise<void>;

  assistantItems: AssistantItem[];
  isAssistantStreaming: boolean;
  onSendMessage: (message: string) => void;
}

export function UnifiedBriefingFeed({
  timelineItems,
  isTimelineStreaming,
  projectStatus,
  onSubmitAnswer,
  onSkipQuestion,
  assistantItems,
  isAssistantStreaming,
  onSendMessage,
}: UnifiedBriefingFeedProps) {
  const { language } = useLanguage();
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<string>>(new Set());

  const handleDismissAction = (id: string) => {
    setDismissedActions((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!autoFollow) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timelineItems, assistantItems, autoFollow]);

  // Detect manual scroll up → disable auto-follow
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement | null;
    if (!viewport) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 60;
      setAutoFollow(isNearBottom);
    };

    viewport.addEventListener('scroll', handleScroll);
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, []);

  const unifiedItems = mergeUnifiedFeed(timelineItems, assistantItems);

  const progressItems = timelineItems.filter((item) => item.type === 'progress');
  const latestProgress = progressItems.length > 0 ? progressItems[progressItems.length - 1] : null;
  const lastThinkingId = [...assistantItems].reverse().find((i) => i.type === 'thinking')?.id;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d0d]" data-testid="unified-briefing-feed">
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 font-mono text-[13px] leading-relaxed text-[#e0e0e0] space-y-1">
          {latestProgress &&
            projectStatus !== 'running' &&
            projectStatus !== 'stopped' &&
            projectStatus !== 'error' && (
              <div className="mb-3 flex gap-1.5 items-center flex-wrap text-[11px]">
                {['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'].map(
                  (step, i, arr) => {
                    const currentIdx = arr.indexOf(latestProgress.stepName ?? '');
                    const isDone = currentIdx > i;
                    const isCurrent = latestProgress.stepName === step;
                    return (
                      <span key={step} className="flex items-center gap-1">
                        <span
                          className={cn(
                            isCurrent && 'text-[#22c55e] font-bold',
                            isDone && 'text-[#4ade80]',
                            !isCurrent && !isDone && 'text-[#555]',
                          )}
                        >
                          {isDone ? '✓' : isCurrent ? '●' : '○'} {step}
                        </span>
                        {step !== 'Complete' && <span className="text-[#333]">→</span>}
                      </span>
                    );
                  },
                )}
              </div>
            )}

          {projectStatus && ['running', 'stopped', 'error'].includes(projectStatus) && (
            <div className="mb-2 text-[11px]">
              <span
                className={cn(
                  projectStatus === 'running' && 'text-[#22c55e]',
                  projectStatus === 'stopped' && 'text-[#666]',
                  projectStatus === 'error' && 'text-[#ef4444]',
                )}
              >
                ● {projectStatus.toUpperCase()}
              </span>
            </div>
          )}

          {unifiedItems.map((uItem, index) => {
            if (uItem.type === 'timeline') {
              const item = uItem.item;
              const isLatest = index === unifiedItems.length - 1 && isTimelineStreaming;

              if (item.type === 'question' && item.questionId && item.questions) {
                return (
                  <div key={item.id} className="my-2">
                    <InputRequestCard
                      questionId={item.questionId}
                      questions={item.questions}
                      answered={item.answered}
                      onSubmit={onSubmitAnswer ?? (() => {})}
                      onSkip={onSkipQuestion ?? (() => {})}
                    />
                  </div>
                );
              }

              if (item.type === 'error') {
                return (
                  <div key={item.id} className="text-[#ef4444]">
                    ✗ {item.title}
                    {item.detail && (
                      <div className="ml-4 text-[11px] text-[#ef4444]/70">{item.detail}</div>
                    )}
                  </div>
                );
              }

              if (item.type === 'success') {
                return (
                  <div key={item.id} className="text-[#22c55e]">
                    ✓ {item.title}
                    {item.url && <span className="ml-2 text-[#60a5fa] underline">{item.url}</span>}
                  </div>
                );
              }

              if (item.type === 'agent_tool_call') {
                return (
                  <div key={item.id} className="text-[#888]">
                    ▸ {item.toolName ?? item.title}
                  </div>
                );
              }

              if (item.type === 'agent_tool_result') {
                const ok = !item.title?.toLowerCase().includes('fail');
                return (
                  <div key={item.id} className={ok ? 'text-[#4ade80]' : 'text-[#ef4444]'}>
                    {ok ? '✓' : '✗'} {item.toolName ?? item.title}
                  </div>
                );
              }

              if (item.type === 'agent_message') {
                return (
                  <div key={item.id} className="text-[#e0e0e0] whitespace-pre-wrap">
                    {item.detail || item.title}
                  </div>
                );
              }

              if (item.type === 'agent_thinking') {
                if (!isLatest) return null;
                return (
                  <div key={item.id} className="text-[#666] italic">
                    ...
                  </div>
                );
              }

              return (
                <div key={item.id} className="text-[#aaa]">
                  {item.title}
                </div>
              );
            }

            if (uItem.type === 'assistant_group') {
              return (
                <div key={uItem.id}>
                  <CollapsedToolGroup items={uItem.items} />
                </div>
              );
            }

            const item = uItem.item;

            if (item.type === 'needs_user_action') {
              if (dismissedActions.has(item.id)) return null;
              return (
                <div key={item.id} className="my-2">
                  <UserActionCard
                    category={item.category || 'Action Required'}
                    message={item.content || ''}
                    detail={item.detail}
                    locale={language}
                    onDismiss={() => handleDismissAction(item.id)}
                  />
                </div>
              );
            }

            if (item.type === 'thinking') {
              if (!isAssistantStreaming || item.id !== lastThinkingId) return null;
              return (
                <div key={item.id} className="text-[#666] italic">
                  ...
                </div>
              );
            }

            if (item.type === 'question' && item.questions && item.questionId) {
              return (
                <div key={item.id} className="my-2">
                  <InputRequestCard
                    questionId={item.questionId}
                    questions={item.questions}
                    onSubmit={onSubmitAnswer}
                    onSkip={onSkipQuestion}
                  />
                </div>
              );
            }

            if (item.type === 'error') {
              return (
                <div key={item.id} className="text-[#ef4444]">
                  ✗ {item.content}
                </div>
              );
            }

            const isUser = item.role === 'user';
            return (
              <div
                key={item.id}
                data-testid={isUser ? 'user-message' : 'ai-message'}
                className={cn('whitespace-pre-wrap', isUser ? 'text-[#60a5fa]' : 'text-[#e0e0e0]')}
              >
                {isUser ? '> ' : ''}
                {item.content}
              </div>
            );
          })}

          {isTimelineStreaming && timelineItems.length > 0 && (
            <div className="text-[#22c55e] flex items-center gap-2 mt-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              <span className="text-[11px] uppercase tracking-wider">Active</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {!autoFollow && (isTimelineStreaming || isAssistantStreaming) && (
        <button
          onClick={() => {
            setAutoFollow(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1 rounded bg-[#1a1a1a] border border-[#333] text-[11px] font-mono text-[#888] hover:text-[#e0e0e0]"
        >
          <ArrowDown className="h-3 w-3" />
          follow
        </button>
      )}

      <div className="shrink-0 border-t border-[#222]">
        <ChatInput
          onSend={onSendMessage}
          disabled={isAssistantStreaming}
          placeholder={language === 'ko' ? '메시지 입력...' : 'Type a message...'}
        />
      </div>
    </div>
  );
}
