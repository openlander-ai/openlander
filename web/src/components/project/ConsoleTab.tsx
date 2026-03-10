import { useState } from 'react';
import { LogViewer } from '@/components/logs/LogViewer';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConsoleTabProps {
  projectId: string;
  isActive: boolean;
  projectStatus: string;
}

export function ConsoleTab({ projectId, isActive, projectStatus }: ConsoleTabProps) {
  const [showTerminal, setShowTerminal] = useState(false);
  const isRunning = projectStatus === 'running';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-[hsl(var(--border))] bg-bg-panel/50">
        <button
          onClick={() => setShowTerminal(!showTerminal)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors',
            showTerminal
              ? 'bg-bg-subtle text-primary-ol font-medium'
              : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
          )}
        >
          <SquareTerminal className="h-3.5 w-3.5" />
          Terminal
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* Left pane: Runtime logs */}
        <div
          className={cn(
            'flex-1 min-w-0 min-h-0',
            showTerminal && 'border-b md:border-b-0 md:border-r border-[hsl(var(--border))]',
          )}
        >
          <LogViewer projectId={projectId} />
        </div>

        {/* Right pane: Terminal */}
        {showTerminal && (
          <div className="flex-1 min-w-0 min-h-0 md:max-w-[50%]">
            {isActive ? (
              <TerminalPanel projectId={projectId} isActive={showTerminal && isRunning} />
            ) : (
              <div className="flex items-center justify-center h-full text-sm font-body text-muted-ol p-4">
                Switch to Console tab to activate terminal
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
