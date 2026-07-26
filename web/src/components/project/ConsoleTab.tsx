import { useState } from 'react';
import { LogViewer } from '@/components/logs/LogViewer';
import { TerminalPanel } from '@/components/deploy-terminal/TerminalPanel';
import { SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_CONSOLE_VIEW_STATE } from '@/types';
import { useLanguage } from '@/i18n/context';

interface ConsoleTabProps {
  projectId: string;
  isActive: boolean;
  projectStatus: string;
}

export function ConsoleTab({ projectId, isActive, projectStatus }: ConsoleTabProps) {
  const { t } = useLanguage();
  const [showTerminal, setShowTerminal] = useState(DEFAULT_CONSOLE_VIEW_STATE.showTerminal);
  const isRunning = projectStatus === 'running';
  const terminalToggleLabel = showTerminal
    ? t('logs.terminalToggle.hide')
    : t('logs.terminalToggle.show');
  const terminalToggleTitle = showTerminal
    ? t('logs.terminalToggle.hideTitle')
    : isRunning
      ? t('logs.terminalToggle.showTitle')
      : t('logs.terminalToggle.showAvailabilityTitle');

  return (
    <div className="flex flex-col h-full min-h-0 p-6 bg-bg-app">
      <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm overflow-hidden">
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
                    ? 'bg-bg-subtle text-foreground font-medium'
                    : 'text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50',
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
