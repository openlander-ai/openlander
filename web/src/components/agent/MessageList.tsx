import { useRef, useEffect, useState, type ReactNode } from 'react';
import type { ChatMessage } from '@/lib/chat-types';
import { MessageBubble } from './MessageBubble';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageListProps {
  messages: ChatMessage[];
  children?: ReactNode; // for injecting thinking indicator, etc.
}

export function MessageList({ messages, children }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAutoScrolling = useRef(true);

  // Auto-scroll on new messages
  useEffect(() => {
    if (isAutoScrolling.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, children]);

  // Detect scroll position
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    isAutoScrolling.current = isNearBottom;
    setShowScrollButton(!isNearBottom);
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
      isAutoScrolling.current = true;
      setShowScrollButton(false);
    }
  };

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4 max-w-3xl mx-auto">
          {messages
            .filter((m) => m.role !== 'system')
            .map((msg, i) => (
              <MessageBubble key={msg.id ?? i} message={msg} />
            ))}
          {children}
        </div>
      </div>
      {showScrollButton && (
        <button
          data-testid="scroll-to-bottom"
          onClick={scrollToBottom}
          className={cn(
            'absolute bottom-4 left-1/2 -translate-x-1/2 z-10',
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'bg-bg-panel border border-[hsl(var(--border))] shadow-lg',
            'text-xs font-body text-foreground/80 hover:text-foreground transition-colors',
          )}
        >
          <ArrowDown className="h-3 w-3" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
