import { Bot } from 'lucide-react';

export function ThinkingIndicator() {
  return (
    <div data-testid="thinking-indicator" className="flex items-start gap-2 px-1 py-2">
      <div className="flex items-center gap-1.5">
        <Bot className="h-3 w-3 text-ai animate-pulse" />
        <span className="text-xs font-medium text-ai/80">Agent is thinking</span>
      </div>
      <div className="flex items-center gap-0.5 pt-[5px]">
        <span
          className="h-1.5 w-1.5 rounded-full bg-ai/60 animate-[bounce-dot_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-ai/60 animate-[bounce-dot_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '200ms' }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-ai/60 animate-[bounce-dot_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: '400ms' }}
        />
      </div>
    </div>
  );
}
