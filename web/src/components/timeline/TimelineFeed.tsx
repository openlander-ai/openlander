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
          <div className="absolute left-[29px] top-6 bottom-6 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

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
            <div className="flex items-center gap-4 py-4 px-5 relative overflow-hidden rounded-lg border border-agent/10 bg-agent/5 mt-2 timeline-item-enter">
              <div className="absolute inset-0 bg-grid-pattern opacity-20" />
              <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-agent/50 to-transparent scanline" />

              <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-agent/10 border border-agent/20 shrink-0">
                <div className="absolute inset-0 rounded-full border border-agent/30 animate-[pulse-ring_2s_cubic-bezier(0.215,0.61,0.355,1)_infinite]" />
                <div className="w-2 h-2 rounded-full bg-agent animate-pulse" />
              </div>

              <div className="relative flex flex-col">
                <span className="text-xs font-mono text-agent/90 uppercase tracking-widest flex items-center gap-2">
                  System Active
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce" />
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-agent/70 animate-bounce [animation-delay:300ms]" />
                  </span>
                </span>
                <span className="text-[10px] font-mono text-muted-ol mt-0.5">
                  Awaiting next instruction...
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
          Follow
        </button>
      )}
    </div>
  );
}
