import { useLanguage } from '@/i18n/context';
import { useAgentActivity } from '@/hooks/use-agent-activity';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, Activity, BrainCircuit, RefreshCw, ChevronRight } from 'lucide-react';
import { relativeTime } from '@/components/ops/utils';

export function AgentActivityPanel() {
  const { t, language } = useLanguage();
  const { activeState, loading } = useAgentActivity();

  if (loading) {
    return <Skeleton className="h-[60px] w-full rounded-xl" />;
  }

  if (!activeState.isActive) {
    return (
      <Card className="border-border bg-panel p-4 flex items-center justify-between opacity-80 hover:opacity-100 transition-opacity cursor-default">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-bg-subtle flex items-center justify-center">
            <Bot className="h-4 w-4 text-muted-ol" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-secondary-ol font-display">
              {t('ops.agent.idle')}
            </h3>
            <p className="text-xs text-muted-ol font-body">{t('ops.agent.idleDesc')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success opacity-50"></span>
          </span>
          <span className="text-xs font-mono text-muted-ol">{t('ops.agent.online')}</span>
        </div>
      </Card>
    );
  }

  const { projectName, currentStep, currentStepNumber, totalSteps, startedAt, thoughtLog } =
    activeState;

  const duration = startedAt
    ? relativeTime(new Date(startedAt).getTime(), language)
    : language === 'ko'
      ? '방금 전'
      : 'just now';
  const progressPercent =
    totalSteps && currentStepNumber
      ? Math.round((currentStepNumber / totalSteps) * 100)
      : undefined;

  return (
    <Card className="border-agent/30 bg-agent/5 p-4 shadow-sm relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Background Animated Pulse */}
      <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-agent/10 blur-3xl animate-pulse" />

      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="relative">
            <div className="h-10 w-10 rounded-full bg-bg-panel border border-agent/20 flex items-center justify-center shadow-sm">
              <Bot className="h-5 w-5 text-agent" />
            </div>
            <div className="absolute -bottom-1 -right-1">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-agent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-agent"></span>
              </span>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-base font-semibold font-display text-primary-ol flex items-center gap-2">
                {t('ops.agent.activeOn')}{' '}
                <span className="text-agent">{projectName || t('ops.agent.system')}</span>
              </h3>
              <span className="text-xs font-mono text-secondary-ol px-1.5 py-0.5 rounded-sm bg-bg-subtle border border-border">
                {progressPercent !== undefined ? `${progressPercent}%` : t('ops.agent.working')}
              </span>
            </div>
            <p className="text-sm font-body text-secondary-ol flex items-center gap-1.5 animate-pulse">
              <RefreshCw className="h-3 w-3 text-agent animate-spin" />
              {currentStep || t('ops.agent.analyzing')}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 min-w-[120px]">
          <span className="text-xs font-mono text-muted-ol uppercase tracking-wider flex items-center gap-1">
            <Activity className="h-3 w-3" /> {t('ops.agent.elapsed')}
          </span>
          <span className="font-mono text-sm text-secondary-ol bg-bg-panel border border-border/50 px-2 rounded-md">
            {duration}
          </span>
        </div>
      </div>

      {progressPercent !== undefined && (
        <div className="mt-4 bg-bg-subtle/50 h-1.5 rounded-full overflow-hidden flex w-full border border-border/50">
          <div
            className="h-full bg-agent transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {thoughtLog && thoughtLog.length > 0 && (
        <div className="mt-4 bg-bg-panel/80 rounded-md p-3 border border-border/50">
          <div className="text-[10px] font-mono text-muted-ol mb-2 flex items-center gap-1 uppercase tracking-wider">
            <BrainCircuit className="h-3 w-3" /> {t('ops.agent.thoughtProcess')}
          </div>
          <div className="space-y-1">
            {thoughtLog.slice(-3).map((log, i) => (
              <div
                key={i}
                className="text-xs font-mono text-secondary-ol flex items-start gap-1.5 opacity-80"
              >
                <ChevronRight className="h-3 w-3 text-agent/50 mt-0.5 shrink-0" />
                <span className="truncate">{log}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
