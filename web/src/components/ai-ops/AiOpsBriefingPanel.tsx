import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { getProjectAiOps, updateProjectAiOps, type AiOpsProjectMode } from '@/lib/api/ai-ops';
import { cn } from '@/lib/utils';

interface AiOpsBriefingPanelProps {
  projectId: string;
  onViewBriefings?: () => void;
}

export function AiOpsBriefingPanel({ projectId, onViewBriefings }: AiOpsBriefingPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<AiOpsProjectMode>('off');
  const [resolvedMode, setResolvedMode] = useState<AiOpsProjectMode>('off');
  const [budgetText, setBudgetText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const policy = await getProjectAiOps(projectId);
      setProjectMode(policy.policy.mode);
      setResolvedMode(policy.policy.mode);
      setBudgetText(`${policy.budget.projectUsed}/${policy.budget.projectLimit}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.load'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProjectMode = async (mode: AiOpsProjectMode) => {
    setSaving(true);
    setError(null);
    try {
      const response = await updateProjectAiOps(projectId, { mode });
      setProjectMode(response.policy.mode);
      setResolvedMode(response.policy.mode);
      setBudgetText(`${response.budget.projectUsed}/${response.budget.projectLimit}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.save'));
    } finally {
      setSaving(false);
    }
  };

  const projectModeButtons: Array<{ value: AiOpsProjectMode; label: string }> = [
    { value: 'off', label: t('aiOps.mode.off') },
    { value: 'briefing', label: t('aiOps.mode.briefing') },
  ];

  return (
    <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-agent" />
            <h3 className="text-sm font-semibold text-foreground">{t('aiOps.title')}</h3>
            <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
              {t('aiOps.beta')}
            </span>
          </div>
          <p className="mt-1 text-xs text-foreground/70">{t('aiOps.projectDescription')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('aiOps.noAutomation')}
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1 rounded-md border border-[hsl(var(--border))] bg-bg-subtle p-1">
          {projectModeButtons.map((option) => {
            const active = projectMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={saving || loading}
                onClick={() => void saveProjectMode(option.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? 'bg-bg-panel text-foreground shadow-sm'
                    : 'text-foreground/60 hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-foreground/60">
          <span>
            {t('aiOps.resolvedMode')}:{' '}
            <strong className="text-foreground">{t(`aiOps.mode.${resolvedMode}`)}</strong>
          </span>
          {budgetText && (
            <span>
              {t('aiOps.budget')}: <strong className="text-foreground">{budgetText}</strong>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {onViewBriefings && (
        <div className="mt-4 rounded-md border border-agent/20 bg-agent/5 px-3 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-relaxed text-foreground/65">
              {t('aiOps.settingsBriefingsHint')}
            </p>
            <button
              type="button"
              onClick={onViewBriefings}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-agent/20 bg-agent/10 px-3 py-1.5 text-[12px] font-medium text-agent transition-colors hover:bg-agent/15"
            >
              {t('aiOps.actions.viewProjectBriefings')}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
