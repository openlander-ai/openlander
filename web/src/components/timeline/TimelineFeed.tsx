import { useEffect, useRef, useState } from 'react';
import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from './InputRequestCard';
import { TimelineItemCard } from './TimelineItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineFeedProps {
  items: TimelineItem[];
  isStreaming: boolean;
  onFixWithAI?: (errorMessage?: string) => void;
  onSubmitAnswer?: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion?: (questionId: string) => void;
  onInsightAction?: (projectId: string, action: string) => Promise<void>;
}

export function TimelineFeed({
  items,
  isStreaming,
  onFixWithAI,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
}: TimelineFeedProps) {
  const [autoFollow, setAutoFollow] = useState(true);
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
          <p className="text-sm font-body text-secondary-ol">No activity yet</p>
          <p className="text-xs font-body text-muted-ol">
            Deploy this project to see the agent timeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <ScrollArea className="h-full" ref={scrollRef}>
        <div className="p-4 space-y-1">
          {/* Vertical connector line */}
          <div className="absolute left-[30px] top-4 bottom-4 w-px bg-[hsl(var(--border))]" />

          {items.map((item, index) => (
            <TimelineItemCard
              key={item.id}
              item={item}
              isLatest={index === items.length - 1 && isStreaming}
              onFixWithAI={item.type === 'error' ? () => onFixWithAI?.(item.title) : undefined}
              onSubmitAnswer={onSubmitAnswer}
              onSkipQuestion={onSkipQuestion}
              onInsightAction={onInsightAction}
            />
          ))}

          {/* Streaming indicator */}
          {isStreaming && items.length > 0 && (
            <div className="flex items-center gap-3 py-3 px-4">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-agent animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-agent animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-agent animate-pulse [animation-delay:300ms]" />
              </div>
              <span className="text-[11px] font-body text-secondary-ol">Agent working...</span>
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
          Follow
        </button>
      )}
    </div>
  );
}
