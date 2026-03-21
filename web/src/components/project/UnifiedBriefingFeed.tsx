import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';

import { InputRequestCard } from '@/components/timeline/InputRequestCard';

interface UnifiedBriefingFeedProps {
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  projectStatus?: string;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
}

export function UnifiedBriefingFeed({
  timelineItems,
  isTimelineStreaming,
  projectStatus,
  onSubmitAnswer,
  onSkipQuestion,
}: UnifiedBriefingFeedProps) {
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (!autoFollow) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timelineItems, autoFollow]);

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

  const progressItems = timelineItems.filter((item) => item.type === 'progress');
  const latestProgress = progressItems.length > 0 ? progressItems[progressItems.length - 1] : null;

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

          {timelineItems.map((item) => {
            if (item.type === 'question' && item.questionId && item.questions) {
              return (
                <div key={item.id} className="my-2">
                  <InputRequestCard
                    questionId={item.questionId}
                    questions={item.questions}
                    answered={item.answered}
                    onSubmit={onSubmitAnswer}
                    onSkip={onSkipQuestion}
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

            return (
              <div key={item.id} className="text-[#aaa]">
                {item.title}
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

      {!autoFollow && isTimelineStreaming && (
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
    </div>
  );
}
