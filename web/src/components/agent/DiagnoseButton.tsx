import { useAgentPanel } from '@/contexts/agent-panel';
import { AISparkle } from '@/components/ui/AISparkle';
import { useSetup } from '@/hooks/use-setup';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

interface DiagnoseButtonProps {
  projectId?: string;
  deployId?: string;
  errorMessage?: string;
  logLines?: string[];
  className?: string;
}

export function DiagnoseButton({
  projectId,
  deployId,
  errorMessage,
  logLines,
  className,
}: DiagnoseButtonProps) {
  const { status } = useSetup();
  const { openPanel } = useAgentPanel();
  const { t } = useLanguage();

  if (status?.llm.ok !== true) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() =>
        openPanel({
          projectId,
          deployId,
          errorMessage,
          logLines,
        })
      }
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-agent/30 bg-agent/5 px-2.5 py-1 text-xs font-body text-agent hover:bg-agent/10 transition-colors',
        className,
      )}
    >
      <AISparkle className="h-3 w-3" />
      <span>{t('agent.diagnoseWithAgent')}</span>
    </button>
  );
}
