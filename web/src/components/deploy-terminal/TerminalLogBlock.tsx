import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { terminalTokens } from './terminal-tokens';

export interface TerminalLogBlockProps {
  logs: string | string[];
  maxHeight?: number | string;
  className?: string;
}

export function TerminalLogBlock({ logs, maxHeight = 384, className }: TerminalLogBlockProps) {
  const logArray = Array.isArray(logs) ? logs : logs.split('\n');

  return (
    <div
      className={cn('rounded-md border overflow-hidden my-1', className)}
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        borderColor: terminalTokens.colors.border,
      }}
    >
      <ScrollArea className="w-full" style={{ maxHeight }}>
        <div
          className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words"
          style={{
            color: terminalTokens.colors.text.muted,
            fontFamily: terminalTokens.typography.fontFamily,
          }}
        >
          {logArray.length === 0 ? (
            <div className="italic opacity-50">No logs available</div>
          ) : (
            logArray.map((log, i) => (
              <div key={i} className="min-h-[1.5em]">
                {log}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
