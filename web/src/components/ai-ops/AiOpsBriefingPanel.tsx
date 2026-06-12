import { useCallback, useEffect, useState } from 'react';
import { Bell, ShieldCheck, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/context';
import {
  getAiOpsBriefing,
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

function severityClass(severity: AiOpsBriefing['severity']): string {
  switch (severity) {
    case 'critical':
      return 'border-error/30 bg-error/10 text-error';
    case 'high':
      return 'border-orange-500/30 bg-orange-500/10 text-orange-600';
    case 'warning':
      return 'border-warning/30 bg-warning/10 text-warning';
    case 'info':
    default:
      return 'border-info/30 bg-info/10 text-info';
  }
}

function formatMoney(value: number | undefined): string {
  if (!value) return '$0.0000';
  return `$${value.toFixed(4)}`;
}

function formatJson(value: unknown): string {
  if (value == null) return 'null';
  return JSON.stringify(value, null, 2);
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
  const [selectedBriefing, setSelectedBriefing] = useState<AiOpsBriefing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const openBriefing = async (briefing: AiOpsBriefing) => {
    setSelectedBriefing(briefing);
    setDetailLoading(true);
    try {
      const detail = await getAiOpsBriefing(briefing.briefing_id);
      setSelectedBriefing(detail.briefing);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.load'));
    } finally {
      setDetailLoading(false);
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
        ) : briefings.length === 0 ? (
          <p className="text-xs text-foreground/60">{t('aiOps.empty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {briefings.slice(0, 5).map((briefing) => (
              <button
                key={briefing.briefing_id}
                type="button"
                onClick={() => void openBriefing(briefing)}
                className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle/40 p-3 text-left transition-colors hover:bg-bg-subtle"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                      severityClass(briefing.severity),
                    )}
                  >
                    {briefing.severity}
                  </span>
                  <span className="truncate text-xs font-medium text-foreground">
                    {briefing.title}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[11.5px] text-foreground/70">
                  {briefing.summary}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={selectedBriefing !== null}
        onOpenChange={(open) => !open && setSelectedBriefing(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedBriefing?.title ?? t('aiOps.detailTitle')}</DialogTitle>
            <DialogDescription>{t('aiOps.detailDescription')}</DialogDescription>
          </DialogHeader>
          {selectedBriefing && (
            <div className="max-h-[65vh] space-y-4 overflow-auto pt-2">
              <div className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                    severityClass(selectedBriefing.severity),
                  )}
                >
                  {selectedBriefing.severity}
                </span>
                <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
                  {selectedBriefing.classification}
                </span>
                {detailLoading && (
                  <span className="text-[11px] text-foreground/60">{t('aiOps.loading')}</span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-foreground/80">
                {selectedBriefing.summary}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Metric
                  label={t('aiOps.tokens')}
                  value={String(selectedBriefing.usage?.total_tokens ?? 0)}
                />
                <Metric
                  label={t('aiOps.cost')}
                  value={formatMoney(selectedBriefing.usage?.cost_usd)}
                />
                <Metric
                  label={t('aiOps.llmCalls')}
                  value={String(selectedBriefing.usage?.count ?? 0)}
                />
              </div>
              <CodeBlock
                label={t('aiOps.suggestedCall')}
                value={formatJson(selectedBriefing.suggested_call)}
              />
              <CodeBlock
                label={t('aiOps.evidence')}
                value={formatJson(selectedBriefing.evidence)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-foreground/50">{label}</div>
      <div className="ol-mono mt-1 text-xs text-foreground">{value}</div>
    </div>
  );
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-foreground/80">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md border border-[hsl(var(--border))] bg-bg-subtle p-3 text-[11px] text-foreground/80">
        {value}
      </pre>
    </div>
  );
}
