import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { terminalTokens } from './terminal-tokens';
import { ArrowDown } from 'lucide-react';

export interface TerminalScrollbackProps {
  children: ReactNode;
  className?: string;
  autoFollow?: boolean;
}

export function TerminalScrollback({
  children,
  className,
  autoFollow = true,
}: TerminalScrollbackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isFollowing, setIsFollowing] = useState(autoFollow);

  const getViewport = useCallback((): HTMLElement | null => {
    if (!rootRef.current) return null;
    return rootRef.current.querySelector('[data-radix-scroll-area-viewport]');
  }, []);

  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [getViewport]);

  useEffect(() => {
    if (isFollowing) {
      const raf = requestAnimationFrame(scrollToBottom);
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [children, isFollowing, scrollToBottom]);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return undefined;

    const onScroll = () => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nearBottom = distanceFromBottom < 32;
      setIsFollowing((prev) => (prev === nearBottom ? prev : nearBottom));
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [children, getViewport]);

  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;
    if (viewport.scrollHeight <= viewport.clientHeight + 1) {
      setIsFollowing(true);
    }
  }, [children, getViewport]);

  return (
    <div ref={rootRef} className={cn('relative flex flex-col h-full overflow-hidden', className)}>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 pb-4">
          {children}
          <div ref={bottomRef} className="h-px" />
        </div>
      </ScrollArea>

      {!isFollowing && (
        <button
          onClick={() => {
            setIsFollowing(true);
            scrollToBottom();
          }}
          className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono transition-opacity bg-black/50 hover:bg-black/80 border backdrop-blur-sm"
          style={{
            borderColor: terminalTokens.colors.border,
            color: terminalTokens.colors.text.primary,
          }}
        >
          <ArrowDown className="w-3 h-3" />
          Resume Auto-scroll
        </button>
      )}
    </div>
  );
}
