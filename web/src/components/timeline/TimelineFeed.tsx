import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from './InputRequestCard';
import { TimelineItemCard } from './TimelineItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Brain } from 'lucide-react';
interface TimelineFeedProps {
  items: TimelineItem[];
  isStreaming: boolean;
  projectStatus?: string;
  onFixWithAI?: (errorMessage?: string, timelineItemId?: string) => void;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
  onInsightAction?: (projectId: string, action: string) => Promise<void>;
  fixingItemId?: string | null;
}

export function TimelineFeed({
  items,
  isStreaming,
  projectStatus,
  onFixWithAI,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
  fixingItemId,
}: TimelineFeedProps) {
  const [autoFollow, setAutoFollow] = useState(true);
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!autoFollow) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items, autoFollow]);

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

  if (items.length === 0 && !isStreaming) {
    return (
      <div className="flex items-center justify-center h-full text-center">
        <div className="space-y-2">
          <p className="text-sm font-body text-secondary-ol">{t('timeline.empty')}</p>
          <p className="text-xs font-body text-muted-ol">{t('timeline.deployToSee')}</p>
        </div>
      </div>
    );
  }

  const progressItems = items.filter((item) => item.type === 'progress');
  const latestProgress = progressItems.length > 0 ? progressItems[progressItems.length - 1] : null;
  const timelineItems = items;
  const processedItems: (TimelineItem | { type: 'ai_divider'; id: string })[] = [];
  let hasThinking = false;
  let inAiSection = false;

  for (let i = 0; i < timelineItems.length; i++) {
    const item = timelineItems[i];
    const isAi = [
      'agent_thinking',
      'agent_tool_call',
      'agent_message',
      'insight',
      'dockerfile_fixed',
      'question',
    ].includes(item.type);

    if (isAi) {
      if (!inAiSection) {
        inAiSection = true;
        processedItems.push({ type: 'ai_divider', id: `divider-${item.id}` });
      }

      if (item.type === 'agent_thinking') {
        if (!hasThinking) {
          processedItems.push(item);
          hasThinking = true;
        } else {
          // Replace the last thinking item
          processedItems[processedItems.length - 1] = item;
        }
      } else {
        processedItems.push(item);
        hasThinking = false;
      }
    } else {
      inAiSection = false;
      processedItems.push(item);
      hasThinking = false;
    }
  }
  return (
    <div className="relative h-full">
      <ScrollArea className="h-full" ref={scrollRef}>
        <div className="p-4 space-y-1">
          {/* Vertical connector line */}
          <div className="absolute left-[29px] top-6 bottom-6 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

          {/* Progress Header */}
          {latestProgress &&
            projectStatus !== 'running' &&
            projectStatus !== 'stopped' &&
            projectStatus !== 'error' && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-white/5">
                <div className="flex justify-between items-center text-[10px] font-mono text-agent/80 uppercase tracking-wider mb-2">
                  <span>{'System Progress'}</span>
                  <span>{latestProgress.percent}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-bg-subtle overflow-hidden border border-white/5 relative">
                  <div
                    className="absolute top-0 left-0 h-full rounded-full bg-agent progress-stripes progress-glow transition-all duration-700 ease-out"
                    style={{ width: `${latestProgress.percent}%` }}
                  />
                </div>
                {latestProgress.stepName && (
                  <div className="mt-3 text-xs font-mono text-muted-ol space-y-1">
                    <div className="flex gap-2 items-center flex-wrap">
                      {['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'].map(
                        (step) => (
                          <div key={step} className="flex items-center gap-1">
                            <span
                              className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-mono',
                                latestProgress.stepName === step
                                  ? 'bg-agent/30 text-agent font-semibold'
                                  : 'text-muted-ol',
                              )}
                            >
                              {step}
                            </span>
                            {step !== 'Complete' && <span className="text-muted-ol">→</span>}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-xs font-body text-primary-ol">{latestProgress.title}</div>
              </div>
            )}

          {/* Status Badge */}
          {projectStatus && ['running', 'stopped', 'error'].includes(projectStatus) && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-white/5 flex items-center gap-3">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  projectStatus === 'running'
                    ? 'bg-success animate-pulse'
                    : projectStatus === 'stopped'
                      ? 'bg-muted-ol'
                      : 'bg-error',
                )}
              />
              <span className="text-xs font-mono uppercase tracking-wider text-primary-ol">
                {projectStatus}
              </span>
            </div>
          )}

          {processedItems.map((item, index) => {
            if ('type' in item && item.type === 'ai_divider') {
              return (
                <div key={item.id} className="flex items-center gap-3 my-6 px-4">
                  <div className="h-px bg-gradient-to-r from-transparent via-agent/50 to-agent/50 flex-1" />
                  <div className="text-xs font-mono font-bold text-agent flex items-center gap-2 uppercase tracking-widest px-3 py-1 rounded-full bg-agent/10 border border-agent/20 shadow-sm shadow-agent/20">
                    <Brain className="h-4 w-4" />
                    {'AI Analysis'}
                  </div>
                  <div className="h-px bg-gradient-to-l from-transparent via-agent/50 to-agent/50 flex-1" />
                </div>
              );
            }

            const timelineItem = item as TimelineItem;
            return (
              <TimelineItemCard
                key={timelineItem.id}
                item={timelineItem}
                isLatest={index === processedItems.length - 1 && isStreaming}
                onFixWithAI={
                  timelineItem.type === 'error'
                    ? () => onFixWithAI?.(timelineItem.title, timelineItem.id)
                    : undefined
                }
                isFixWithAILoading={fixingItemId === timelineItem.id}
                onSubmitAnswer={onSubmitAnswer}
                onSkipQuestion={onSkipQuestion}
                onInsightAction={onInsightAction}
              />
            );
          })}
          {/* Streaming indicator */}
          {isStreaming && items.length > 0 && (
            <div className="flex items-center gap-4 py-4 px-5 relative overflow-hidden rounded-lg border border-agent/10 bg-agent/5 mt-2 timeline-item-enter">
              <div className="absolute inset-0 bg-grid-pattern opacity-20" />
              <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-agent/50 to-transparent scanline" />

              <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-agent/10 border border-agent/20 shrink-0">
                <div className="absolute inset-0 rounded-full border border-agent/30 animate-[pulse-ring_2s_cubic-bezier(0.215,0.61,0.355,1)_infinite]" />
                <div className="w-2 h-2 rounded-full bg-agent animate-pulse" />
              </div>

              <div className="relative flex flex-col">
                <span className="text-xs font-mono text-agent/90 uppercase tracking-widest flex items-center gap-2">
                  {'System Active'}
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce" />
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce [animation-delay:300ms]" />
                  </span>
                </span>
                <span className="text-[10px] font-mono text-muted-ol mt-0.5">
                  {t('timeline.awaitingInstruction')}
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Follow button when scrolled up */}
      {!autoFollow && isStreaming && (
        <button
          onClick={() => {
            setAutoFollow(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className={cn(
            'absolute bottom-4 left-1/2 -translate-x-1/2 z-10',
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'bg-bg-panel border border-[hsl(var(--border))] shadow-lg',
            'text-[11px] font-body text-secondary-ol hover:text-primary-ol transition-colors',
          )}
        >
          <ArrowDown className="h-3 w-3" />
          {'Follow'}
        </button>
      )}
    </div>
  );
}
