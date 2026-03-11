export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 text-agent/80">
      <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-agent/10 border border-agent/20 shrink-0">
        <div className="w-1.5 h-1.5 rounded-full bg-agent animate-pulse" />
      </div>
      <span className="text-xs font-mono uppercase tracking-widest">AI is thinking...</span>
    </div>
  );
}
