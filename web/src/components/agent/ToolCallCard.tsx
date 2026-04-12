import { useState } from 'react';
import { Wrench, Check, X, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import type { ToolCallInfo } from '@/lib/chat-types';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = !!toolCall.toolResult;
  const isSuccess = toolCall.toolResult?.success ?? true;

  return (
    <div
      data-testid="tool-call-card"
      className="border border-border rounded-md my-2 overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-bg-subtle"
      >
        <Wrench className="h-3.5 w-3.5 text-muted-ol" />
        <span className="font-medium flex-1 text-left">{toolCall.toolName}</span>
        {!hasResult ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-ol" />
        ) : isSuccess ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <X className="h-3.5 w-3.5 text-error" />
        )}
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-bg-terminal text-xs">
          {Object.keys(toolCall.arguments).length > 0 && (
            <div className="mb-2">
              <span className="text-muted-ol">Arguments:</span>
              <pre className="mt-1 overflow-x-auto text-xs">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.toolResult && (
            <div>
              <span className="text-muted-ol">Result:</span>
              <pre className="mt-1 overflow-x-auto text-xs">
                {toolCall.toolResult.error || JSON.stringify(toolCall.toolResult.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
