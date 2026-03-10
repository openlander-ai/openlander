import { LogViewer } from '@/components/logs/LogViewer';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';

interface ConsoleTabProps {
  projectId: string;
  isActive: boolean;
  projectStatus: string;
}

export function ConsoleTab({ projectId, isActive, projectStatus }: ConsoleTabProps) {
  const isRunning = projectStatus === 'running';

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      {/* Left pane: Runtime logs */}
      <div className="flex-1 min-w-0 min-h-0 border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
        <LogViewer projectId={projectId} />
      </div>

      {/* Right pane: Terminal */}
      <div className="flex-1 min-w-0 min-h-0 md:max-w-[50%]">
        {isActive ? (
          <TerminalPanel projectId={projectId} isActive={isRunning} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm font-body text-muted-ol p-4">
            Switch to Console tab to activate terminal
          </div>
        )}
      </div>
    </div>
  );
}
