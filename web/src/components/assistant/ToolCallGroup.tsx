import React from 'react';
import { Bot, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssistantItem } from '@/hooks/use-assistant';

import { ToolResultContent, maskSecrets } from './ToolResultContent';

export function ToolCallItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="rounded-md border border-agent/20 bg-agent/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono text-agent hover:bg-agent/10 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Bot className="h-3 w-3" />
          {item.toolName}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && item.toolArgs && (
        <div className="px-3 py-2 border-t border-agent/10 bg-bg-app/50">
          <pre className="text-[10px] font-mono text-muted-ol whitespace-pre-wrap break-all">
            {JSON.stringify(maskSecrets(item.toolArgs), null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolResultItem({ item }: { item: AssistantItem }) {
  const [expanded, setExpanded] = React.useState(false);
  const isSuccess = item.toolSuccess !== false;
  return (
    <div
      className={cn(
        'rounded-md border overflow-hidden',
        isSuccess ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5',
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center justify-between px-3 py-1.5 text-xs font-mono transition-colors',
          isSuccess ? 'text-success hover:bg-success/10' : 'text-error hover:bg-error/10',
        )}
      >
        <span className="flex items-center gap-2">
          {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {item.toolName} {isSuccess ? '✓' : '✗'}
        </span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-black/10 bg-bg-app/50">
          {item.toolError ? (
            <pre
              className={cn(
                'text-[10px] font-mono whitespace-pre-wrap break-all',
                isSuccess ? 'text-success/80' : 'text-error/80',
              )}
            >
              {item.toolError}
            </pre>
          ) : (
            <ToolResultContent toolName={item.toolName || ''} result={item.toolResult} />
          )}
        </div>
      )}
    </div>
  );
}

export function CollapsedToolGroup({ items }: { items: AssistantItem[] }) {
  const [expanded, setExpanded] = React.useState(false);

  const toolNames = [...new Set(items.filter((i) => i.toolName).map((i) => i.toolName!))];
  const isComplete = items.some((i) => i.type === 'tool_result');

  const firstItem = items[0];
  const lastItem = items[items.length - 1];
  const duration =
    lastItem &&
    firstItem &&
    new Date(lastItem.timestamp).getTime() > new Date(firstItem.timestamp).getTime()
      ? Math.round(
          (new Date(lastItem.timestamp).getTime() - new Date(firstItem.timestamp).getTime()) / 1000,
        )
      : null;

  return (
    <div data-testid="tool-call-group" className="font-mono text-xs leading-relaxed">
      {toolNames.map((name) => {
        const result = items.find((i) => i.type === 'tool_result' && i.toolName === name);
        const isFailed = result?.toolSuccess === false;
        const isDone = !!result;
        return (
          <div key={name} className="flex items-center gap-1.5 py-0.5">
            <span
              className={cn(
                'shrink-0',
                isFailed ? 'text-error' : isDone ? 'text-success' : 'text-agent',
              )}
            >
              {isFailed ? '✗' : isDone ? '✓' : '▸'}
            </span>
            <span className={cn('text-muted-ol', isFailed && 'text-error/80')}>{name}</span>
            {isDone && duration !== null && duration > 0 && (
              <span className="text-[10px] text-muted-ol/50">{duration}s</span>
            )}
          </div>
        );
      })}
      {isComplete && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-muted-ol/50 hover:text-muted-ol mt-0.5 flex items-center gap-1"
        >
          {expanded ? (
            <ChevronUp className="h-2.5 w-2.5" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5" />
          )}
          {expanded ? 'hide details' : 'details'}
        </button>
      )}
      {expanded && (
        <div className="mt-1 pl-4 border-l border-white/5 space-y-1">
          {items.map((item) =>
            item.type === 'tool_call' ? (
              <ToolCallItem key={item.id} item={item} />
            ) : (
              <ToolResultItem key={item.id} item={item} />
            ),
          )}
        </div>
      )}
    </div>
  );
}
