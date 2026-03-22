import { Bot } from 'lucide-react';

interface EmptyStateProps {
  onSendMessage: (message: string) => void;
}

const suggestions = [
  "What's the server status?",
  'Deploy latest commit',
  'Show recent failures',
  'List all services',
];

export function EmptyState({ onSendMessage }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center h-full gap-6"
    >
      <div className="text-center space-y-2">
        <div className="mx-auto h-12 w-12 rounded-full bg-bg-subtle flex items-center justify-center">
          <Bot className="h-6 w-6 text-muted-ol" />
        </div>
        <h3 className="text-sm font-medium text-primary-ol">Start a conversation</h3>
        <p className="text-xs text-muted-ol">Ask your deployment agent anything</p>
      </div>
      <div className="flex flex-wrap gap-2.5 justify-center max-w-md">
        {suggestions.map((s) => (
          <button
            key={s}
            data-testid="suggestion-chip"
            onClick={() => onSendMessage(s)}
            className="px-4 py-2 rounded-full border border-border bg-bg-app shadow-sm text-sm text-secondary-ol hover:border-border/80 hover:bg-bg-subtle hover:text-primary-ol hover:shadow transition-all"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function StreamError({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div
      data-testid="stream-error"
      className="flex items-center gap-2 px-4 py-2 mx-4 my-2 rounded-lg bg-error/10 border border-error/20 text-xs text-error"
    >
      <span className="flex-1">{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs underline hover:no-underline">
          Retry
        </button>
      )}
    </div>
  );
}
