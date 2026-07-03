import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Filter, ShieldCheck, Sparkles } from 'lucide-react';
import { AiOpsBriefingFeed } from '@/components/ai-ops/AiOpsBriefingFeed';
import { useLanguage } from '@/i18n/context';
import {
  getProjectAiOps,
  getServiceAiOps,
  listProjectAiOpsBriefings,
  listServiceAiOpsBriefings,
  type AiOpsBriefing,
  type AiOpsBriefingStatusFilter,
  type AiOpsProjectMode,
  type ServiceAiOpsResponse,
} from '@/lib/api/ai-ops';
import { listGroupServices, type GroupService } from '@/lib/api/services';
import { cn } from '@/lib/utils';

interface ProjectAiOpsTabProps {
  projectId: string;
  degradedResourceCount?: number;
  onConfigure?: () => void;
}

const ALL_SERVICES = 'all';

const STATUS_FILTERS: Array<{
  value: AiOpsBriefingStatusFilter | 'all';
  labelKey: string;
}> = [
  { value: 'unresolved', labelKey: 'aiOps.status.unresolved' },
  { value: 'open', labelKey: 'aiOps.status.open' },
  { value: 'acknowledged', labelKey: 'aiOps.status.acknowledged' },
  { value: 'resolved', labelKey: 'aiOps.status.resolved' },
  { value: 'all', labelKey: 'aiOps.status.all' },
];

export function ProjectAiOpsTab({
  projectId,
  degradedResourceCount = 0,
  onConfigure,
}: ProjectAiOpsTabProps) {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedServiceId = searchParams.get('service') ?? ALL_SERVICES;
  const [status, setStatus] = useState<AiOpsBriefingStatusFilter | 'all'>('unresolved');
  const [briefings, setBriefings] = useState<AiOpsBriefing[]>([]);
  const [services, setServices] = useState<GroupService[]>([]);
  const [selectedServicePolicy, setSelectedServicePolicy] = useState<ServiceAiOpsResponse | null>(
    null,
  );
  const [projectMode, setProjectMode] = useState<AiOpsProjectMode>('off');
  const [budgetText, setBudgetText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedService = useMemo(
    () =>
      selectedServiceId === ALL_SERVICES
        ? null
        : (services.find((service) => service.id === selectedServiceId) ?? null),
    [selectedServiceId, services],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policy, serviceRows] = await Promise.all([
        getProjectAiOps(projectId),
        listGroupServices(projectId),
      ]);
      setProjectMode(policy.policy.mode);
      setBudgetText(`${policy.budget.projectUsed}/${policy.budget.projectLimit}`);
      setServices(serviceRows);

      const selectedRow =
        selectedServiceId === ALL_SERVICES
          ? null
          : (serviceRows.find((service) => service.id === selectedServiceId) ?? null);

      if (selectedServiceId !== ALL_SERVICES && !selectedRow) {
        setSelectedServicePolicy(null);
        setBriefings([]);
        setError(t('aiOps.projectInbox.serviceUnavailable'));
        return;
      }

      if (selectedRow) {
        const [servicePolicy, response] = await Promise.all([
          getServiceAiOps(projectId, selectedRow.id),
          listServiceAiOpsBriefings(projectId, selectedRow.id, {
            limit: 50,
            status: status === 'all' ? undefined : status,
          }),
        ]);
        setSelectedServicePolicy(servicePolicy);
        setBriefings(response.briefings ?? []);
        return;
      }

      const response = await listProjectAiOpsBriefings(projectId, {
        limit: 50,
        status: status === 'all' ? undefined : status,
      });
      setSelectedServicePolicy(null);
      setBriefings(response.briefings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.load'));
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedServiceId, status, t]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const updateSelectedService = (serviceId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'ai');
    if (serviceId === ALL_SERVICES) {
      next.delete('service');
    } else {
      next.set('service', serviceId);
    }
    setSearchParams(next, { replace: true });
  };

  const servicePolicyText =
    selectedServicePolicy == null
      ? null
      : selectedServicePolicy.resolved_policy.source === 'project'
        ? t('aiOps.projectInbox.servicePolicyFollows', {
            mode: t(`aiOps.mode.${selectedServicePolicy.resolved_policy.mode}`),
          })
        : t('aiOps.projectInbox.servicePolicyOverride', {
            mode: t(`aiOps.mode.${selectedServicePolicy.resolved_policy.mode}`),
          });

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-agent" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('aiOps.projectInbox.title')}
            </h3>
          </div>
          <p className="mt-1 text-xs text-foreground/70">{t('aiOps.projectInbox.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
              projectMode === 'briefing'
                ? 'border-agent/20 bg-agent/10 text-agent'
                : 'border-[hsl(var(--border))] bg-bg-subtle text-foreground/60',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {t(`aiOps.mode.${projectMode}`)}
          </span>
          {budgetText && (
            <span className="rounded-full border border-[hsl(var(--border))] bg-bg-subtle px-2.5 py-1 text-[11px] text-foreground/60">
              {t('aiOps.budget')}: <strong className="text-foreground">{budgetText}</strong>
            </span>
          )}
        </div>
      </div>

      <div
        className={cn(
          'rounded-md border px-3 py-3',
          projectMode === 'briefing'
            ? 'border-agent/20 bg-agent/5'
            : 'border-warning/30 bg-warning/10',
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {projectMode === 'briefing'
                ? t('aiOps.projectInbox.enabledTitle')
                : t('aiOps.projectInbox.disabledTitle')}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/65">
              {projectMode === 'briefing'
                ? t('aiOps.projectInbox.enabledDescription')
                : t('aiOps.projectInbox.disabledDescription')}
            </p>
          </div>
          {onConfigure && (
            <button
              type="button"
              onClick={onConfigure}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 py-1.5 text-[12px] font-medium text-foreground/75 transition-colors hover:text-foreground"
            >
              {t('aiOps.projectInbox.configure')}
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <label className="flex min-w-0 items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2 text-[12px] text-foreground/70">
          <Filter className="h-3.5 w-3.5 text-foreground/50" />
          <span className="shrink-0 font-medium text-foreground/80">
            {t('aiOps.projectInbox.serviceFilter')}
          </span>
          <select
            value={selectedServiceId}
            onChange={(event) => updateSelectedService(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none"
          >
            <option value={ALL_SERVICES}>{t('aiOps.projectInbox.allServices')}</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-1 rounded-md border border-[hsl(var(--border))] bg-bg-subtle p-1">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-[11.5px] transition-colors',
                status === option.value
                  ? 'bg-bg-panel text-foreground shadow-sm'
                  : 'text-foreground/60 hover:text-foreground',
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {selectedService && servicePolicyText && (
        <div className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2">
          <div className="text-[11px] font-medium text-foreground">{selectedService.name}</div>
          <div className="mt-0.5 text-[12px] text-foreground/65">{servicePolicyText}</div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <AiOpsBriefingFeed
        briefings={briefings}
        loading={loading}
        emptyEyebrow={
          projectMode === 'briefing'
            ? t('aiOps.projectInbox.emptyEyebrowEnabled')
            : t('aiOps.projectInbox.emptyEyebrowDisabled')
        }
        emptyTitle={t('aiOps.projectInbox.emptyTitle')}
        emptyDescription={
          projectMode === 'briefing' && degradedResourceCount > 0
            ? t('aiOps.projectInbox.emptyDescriptionWithDegradedResources', {
                count: degradedResourceCount,
              })
            : projectMode === 'briefing'
              ? t('aiOps.projectInbox.emptyDescription')
              : t('aiOps.projectInbox.emptyDescriptionDisabled')
        }
        emptyActions={
          onConfigure ? (
            <button
              type="button"
              onClick={onConfigure}
              className="inline-flex items-center gap-1.5 rounded-md border border-agent/20 bg-agent/10 px-3 py-1.5 text-[12px] font-medium text-agent transition-colors hover:bg-agent/15"
            >
              {t('aiOps.projectInbox.configure')}
              <ChevronRight className="h-3 w-3" />
            </button>
          ) : null
        }
        showScope
        onError={setError}
        onStatusChanged={() => load()}
      />
    </div>
  );
}
