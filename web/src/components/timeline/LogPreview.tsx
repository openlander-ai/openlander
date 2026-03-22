import { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronUp, ChevronDown, ExternalLink } from 'lucide-react';
import { useTimeline } from '@/hooks/use-timeline';
import { cn } from '@/lib/utils';
import { parseAnsiLine } from '@/lib/ansi';

interface LogPreviewProps {
  projectId: string;
  status: string;
  onOpenLogs: () => void;
}

export function LogPreview({ projectId, status, onOpenLogs }: LogPreviewProps) {
  const [isOpen, setIsOpen] = useState(true);
  const { items } = useTimeline({
    projectId,
    enabled: isOpen || status === 'building',
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-open when building
  useEffect(() => {
    if (status === 'building') {
      setIsOpen(true);
    }
  }, [status]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isOpen) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, isOpen]);

  // Filter to only show log and status entries
  const logItems = items.filter(
    (item) =>
      item.type === 'log' ||
      item.type === 'progress' ||
      item.type === 'error' ||
      item.type === 'success',
  );

  // Get last 20 entries
  const displayEntries = logItems.slice(-20);
  return (
    <div className="border-t border-[hsl(var(--border))] bg-bg-panel flex flex-col shrink-0">
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-bg-subtle transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 text-xs font-body text-secondary-ol">
          <Terminal className="h-3.5 w-3.5" />
          <span className="font-medium">Live Logs</span>
          {status === 'building' && (
            <span className="flex h-2 w-2 rounded-full bg-warning animate-pulse ml-1" />
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenLogs();
            }}
            className="flex items-center gap-1 text-[10px] font-body text-muted-ol hover:text-agent transition-colors"
          >
            <span>Open full logs</span>
            <ExternalLink className="h-3 w-3" />
          </button>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-ol" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-ol" />
          )}
        </div>
      </div>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-in-out bg-bg-terminal',
          isOpen ? 'max-h-[220px] border-t border-[hsl(var(--border))]' : 'max-h-0',
        )}
      >
        <div
          ref={scrollRef}
          className="p-3 h-[220px] overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {displayEntries.length === 0 ? (
            <div className="text-muted-ol italic">Waiting for logs...</div>
          ) : (
            displayEntries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'break-all whitespace-pre-wrap',
                  entry.type === 'error' ? 'text-error' : 'text-secondary-ol',
                )}
              >
                {entry.type === 'log' ? (
                  <span dangerouslySetInnerHTML={{ __html: parseAnsiLine(entry.title) }} />
                ) : (
                  entry.title
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
