export function ThinkingIndicator() {
  return (
    <div data-testid="thinking-indicator" className="flex items-center gap-2 px-4 py-2">
      <div className="flex gap-1">
        <span
          className="h-2 w-2 bg-muted-ol rounded-full animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-2 w-2 bg-muted-ol rounded-full animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-2 w-2 bg-muted-ol rounded-full animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span className="text-xs text-muted-ol">Thinking...</span>
    </div>
  );
}
