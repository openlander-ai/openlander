import { useState } from 'react';
import { Bot, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantItem } from '@/hooks/use-assistant';

export function ToolCallItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-2 rounded-md border border-agent/20 bg-agent/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono text-agent hover:bg-agent/10 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Bot className="h-3.5 w-3.5" />
          Calling {item.toolName}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && item.toolArgs && (
        <div className="px-3 py-2 border-t border-agent/10 bg-bg-app/50">
          <pre className="text-[10px] font-mono text-muted-ol whitespace-pre-wrap break-all">
            {JSON.stringify(item.toolArgs, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolResultItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = useState(false);
  const isSuccess = item.toolSuccess !== false;
  return (
    <div
      className={cn(
        'my-2 rounded-md border overflow-hidden',
        isSuccess ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-xs font-mono transition-colors',
          isSuccess ? 'text-success hover:bg-success/10' : 'text-error hover:bg-error/10',
        )}
      >
        <span className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {item.toolName} {isSuccess ? 'completed' : 'failed'}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-black/10 bg-bg-app/50">
          <pre
            className={cn(
              'text-[10px] font-mono whitespace-pre-wrap break-all',
              isSuccess ? 'text-success/80' : 'text-error/80',
            )}
          >
            {item.toolError || JSON.stringify(item.toolResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
