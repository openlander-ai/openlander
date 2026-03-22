import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from './InputRequestCard';
import { TimelineItemCard } from './TimelineItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineFeedProps {
  items: TimelineItem[];
  isStreaming: boolean;
  projectStatus?: string;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
}

export function TimelineFeed({
  items,
  isStreaming,
  projectStatus,
  onSubmitAnswer,
  onSkipQuestion,
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
              <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-border">
                <div className="flex gap-2 items-center flex-wrap">
                  {['Preparing', 'Clone', 'Build', 'Start', 'Health Check', 'Complete'].map(
                    (step, i, arr) => {
                      const currentIdx = arr.indexOf(latestProgress.stepName ?? '');
                      const isDone = currentIdx > i;
                      const isCurrent = latestProgress.stepName === step;
                      return (
                        <div key={step} className="flex items-center gap-1">
                          <span
                            className={cn(
                              'px-2 py-0.5 rounded text-[10px] font-mono',
                              isCurrent && 'bg-agent/30 text-agent font-semibold',
                              isDone && 'text-success',
                              !isCurrent && !isDone && 'text-muted-ol',
                            )}
                          >
                            {isDone ? '✓ ' : ''}
                            {step}
                          </span>
                          {step !== 'Complete' && <span className="text-muted-ol">→</span>}
                        </div>
                      );
                    },
                  )}
                </div>
                {latestProgress.title && (
                  <div className="mt-2 text-xs font-body text-primary-ol">
                    {latestProgress.title}
                  </div>
                )}
              </div>
            )}

          {/* Status Badge */}
          {projectStatus && ['running', 'stopped', 'error'].includes(projectStatus) && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-bg-subtle/40 border border-border flex items-center gap-3">
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

          {items.map((timelineItem, index) => {
            return (
              <TimelineItemCard
                key={timelineItem.id}
                item={timelineItem}
                isLatest={index === items.length - 1 && isStreaming}
                onSubmitAnswer={onSubmitAnswer}
                onSkipQuestion={onSkipQuestion}
              />
            );
          })}

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
