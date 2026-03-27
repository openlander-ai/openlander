import { useState } from 'react';
import { LogViewer } from '@/components/logs/LogViewer';
import { TerminalPanel } from '@/components/deploy-terminal/TerminalPanel';
import { SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_CONSOLE_VIEW_STATE } from '@/types';

interface ConsoleTabProps {
  projectId: string;
  isActive: boolean;
  projectStatus: string;
}

export function ConsoleTab({ projectId, isActive, projectStatus }: ConsoleTabProps) {
  const [showTerminal, setShowTerminal] = useState(DEFAULT_CONSOLE_VIEW_STATE.showTerminal);
  const isRunning = projectStatus === 'running';
  const terminalToggleLabel = showTerminal ? 'Hide terminal' : 'Show terminal';
  const terminalToggleTitle = showTerminal
    ? 'Hide the shell and keep logs primary'
    : isRunning
      ? 'Show the shell beside live logs'
      : 'Show terminal status and availability';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <div
          className={cn(
            'flex-1 min-w-0 min-h-0',
            showTerminal && 'border-b md:border-b-0 md:border-r border-[hsl(var(--border))]',
          )}
        >
          <LogViewer
            projectId={projectId}
            toolbarActions={
              <button
                type="button"
                onClick={() => setShowTerminal(!showTerminal)}
                aria-pressed={showTerminal}
                title={terminalToggleTitle}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body transition-colors',
                  showTerminal
                    ? 'bg-bg-subtle text-primary-ol font-medium'
                    : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
                )}
              >
                <SquareTerminal className="h-3.5 w-3.5" />
                {terminalToggleLabel}
              </button>
            }
          />
        </div>

        {showTerminal && (
          <div className="min-w-0 min-h-0 h-[16rem] md:h-auto md:w-[28rem] md:max-w-[45%] md:flex-none">
            <TerminalPanel
              projectId={projectId}
              isConsoleActive={isActive}
              projectStatus={projectStatus}
            />
          </div>
        )}
      </div>
    </div>
  );
}
