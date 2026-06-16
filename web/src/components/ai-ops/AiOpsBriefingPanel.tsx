import { useCallback, useEffect, useState } from 'react';
import { Bell, ShieldCheck, Sparkles } from 'lucide-react';
import { AiOpsBriefingFeed } from '@/components/ai-ops/AiOpsBriefingFeed';
import { useLanguage } from '@/i18n/context';
import {
  getProjectAiOps,
  getServiceAiOps,
  listServiceAiOpsBriefings,
  updateProjectAiOps,
  updateServiceAiOps,
  type AiOpsBriefing,
  type AiOpsProjectMode,
  type AiOpsServiceOverrideMode,
} from '@/lib/api/ai-ops';
import { cn } from '@/lib/utils';

type AiOpsScope = 'project' | 'service';

interface AiOpsBriefingPanelProps {
  scope: AiOpsScope;
  projectId: string;
  serviceId?: string;
}

export function AiOpsBriefingPanel({ scope, projectId, serviceId }: AiOpsBriefingPanelProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<AiOpsProjectMode>('off');
  const [serviceMode, setServiceMode] = useState<AiOpsServiceOverrideMode>('inherit');
  const [resolvedMode, setResolvedMode] = useState<AiOpsProjectMode>('off');
  const [budgetText, setBudgetText] = useState('');
  const [briefings, setBriefings] = useState<AiOpsBriefing[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (scope === 'service' && serviceId) {
        const [policy, list] = await Promise.all([
          getServiceAiOps(projectId, serviceId),
          listServiceAiOpsBriefings(projectId, serviceId),
        ]);
        setProjectMode(policy.project_policy.mode);
        setServiceMode(policy.service_override.mode);
        setResolvedMode(policy.resolved_policy.mode);
        setBudgetText('');
        setBriefings(list.briefings ?? []);
      } else {
        const policy = await getProjectAiOps(projectId);
        setProjectMode(policy.policy.mode);
        setResolvedMode(policy.policy.mode);
        setBudgetText(`${policy.budget.projectUsed}/${policy.budget.projectLimit}`);
        setBriefings(policy.recent_briefings ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.load'));
    } finally {
      setLoading(false);
    }
  }, [projectId, scope, serviceId, t]);

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
      setBriefings(response.recent_briefings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.save'));
    } finally {
      setSaving(false);
    }
  };

  const saveServiceMode = async (mode: AiOpsServiceOverrideMode) => {
    if (!serviceId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await updateServiceAiOps(projectId, serviceId, { mode });
      setProjectMode(response.project_policy.mode);
      setServiceMode(response.service_override.mode);
      setResolvedMode(response.resolved_policy.mode);
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
  const serviceModeButtons: Array<{ value: AiOpsServiceOverrideMode; label: string }> = [
    { value: 'inherit', label: t('aiOps.mode.inherit') },
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
          <p className="mt-1 text-xs text-foreground/70">
            {scope === 'service' ? t('aiOps.serviceDescription') : t('aiOps.projectDescription')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-foreground/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('aiOps.noAutomation')}
        </div>
      </header>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1 rounded-md border border-[hsl(var(--border))] bg-bg-subtle p-1">
          {(scope === 'service' ? serviceModeButtons : projectModeButtons).map((option) => {
            const active =
              scope === 'service' ? serviceMode === option.value : projectMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={saving || loading}
                onClick={() =>
                  scope === 'service'
                    ? void saveServiceMode(option.value as AiOpsServiceOverrideMode)
                    : void saveProjectMode(option.value as AiOpsProjectMode)
                }
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

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground/80">
          <Bell className="h-3.5 w-3.5" />
          {t('aiOps.recentBriefings')}
        </div>
        {loading ? (
          <p className="text-xs text-foreground/60">{t('aiOps.loading')}</p>
        ) : (
          <AiOpsBriefingFeed
            briefings={briefings}
            maxItems={5}
            emptyTitle={t('aiOps.emptyTitle')}
            emptyDescription={t('aiOps.emptyDescription')}
            onError={setError}
          />
        )}
      </div>
    </section>
  );
}
