export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-agent/10 border border-agent/20">
        <div className="flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-agent animate-[bounce-dot_1.4s_ease-in-out_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-agent animate-[bounce-dot_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-1.5 h-1.5 rounded-full bg-agent animate-[bounce-dot_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
      <span className="text-sm font-body text-agent/70">Thinking...</span>
    </div>
  );
}
