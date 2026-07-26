import { useState, type ReactNode } from 'react';
import { Check, Copy, Eye, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useCopy } from '@/hooks/use-copy';
import { useLanguage } from '@/i18n/context';
import { buildAiOpsAgentHandoffPrompt, buildAiOpsVerificationCall } from '@/lib/ai-ops-handoff';
import {
  getAiOpsBriefing,
  updateAiOpsBriefingStatus,
  type AiOpsBriefing,
  type AiOpsBriefingStatus,
} from '@/lib/api/ai-ops';
import { cn } from '@/lib/utils';
import { localizeApiError } from '@/lib/localized-api-error';
import {
  localizedBriefingClassification,
  localizedBriefingSummary,
  localizedBriefingTitle,
} from '@/lib/ai-ops-presentation';

interface AiOpsBriefingFeedProps {
  briefings: AiOpsBriefing[];
  loading?: boolean;
  maxItems?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyEyebrow?: string;
  emptyActions?: ReactNode;
  showScope?: boolean;
  onError?: (message: string) => void;
  onStatusChanged?: (briefing: AiOpsBriefing) => void | Promise<void>;
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

function statusClass(status: AiOpsBriefing['status']): string {
  if (status === 'resolved') return 'border-success/30 bg-success/10 text-success';
  if (status === 'acknowledged') return 'border-info/30 bg-info/10 text-info';
  return 'border-[hsl(var(--border))] bg-bg-subtle text-foreground/60';
}

function formatMoney(value: number | undefined): string {
  if (!value) return '$0.0000';
  return `$${value.toFixed(4)}`;
}

function formatJson(value: unknown): string {
  if (value == null) return 'null';
  return JSON.stringify(value, null, 2);
}

export function AiOpsBriefingFeed({
  briefings,
  loading = false,
  maxItems,
  emptyTitle,
  emptyDescription,
  emptyEyebrow,
  emptyActions,
  showScope = false,
  onError,
  onStatusChanged,
}: AiOpsBriefingFeedProps) {
  const { t } = useLanguage();
  const [selectedBriefing, setSelectedBriefing] = useState<AiOpsBriefing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const { copy, isCopied } = useCopy();
  const visibleBriefings = maxItems ? briefings.slice(0, maxItems) : briefings;

  const openBriefing = async (briefing: AiOpsBriefing) => {
    setSelectedBriefing(briefing);
    setDetailLoading(true);
    try {
      const detail = await getAiOpsBriefing(briefing.briefing_id);
      setSelectedBriefing(detail.briefing);
    } catch (err) {
      onError?.(localizeApiError(err, t, 'aiOps.error.load', 'aiOps.error.codes'));
    } finally {
      setDetailLoading(false);
    }
  };

  const copyAgentHandoff = (briefing: AiOpsBriefing) => {
    void copy(buildAiOpsAgentHandoffPrompt(briefing), `ai-ops-handoff-${briefing.briefing_id}`);
  };

  const copyVerificationCall = (briefing: AiOpsBriefing) => {
    void copy(buildAiOpsVerificationCall(briefing), `ai-ops-verify-${briefing.briefing_id}`);
  };

  const changeBriefingStatus = async (briefing: AiOpsBriefing, status: AiOpsBriefingStatus) => {
    const updateKey = `${briefing.briefing_id}:${status}`;
    setStatusUpdating(updateKey);
    try {
      const response = await updateAiOpsBriefingStatus(briefing.briefing_id, status);
      setSelectedBriefing((current) =>
        current?.briefing_id === briefing.briefing_id
          ? {
              ...current,
              status: response.briefing.status,
              updated_at: response.briefing.updated_at,
            }
          : current,
      );
      await onStatusChanged?.(response.briefing);
    } catch (err) {
      onError?.(localizeApiError(err, t, 'aiOps.error.status', 'aiOps.error.codes'));
    } finally {
      setStatusUpdating(null);
    }
  };

  const renderStatusActions = (briefing: AiOpsBriefing) => {
    if (briefing.status === 'resolved') return null;

    return (
      <>
        {briefing.status === 'open' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={statusUpdating === `${briefing.briefing_id}:acknowledged`}
            onClick={() => void changeBriefingStatus(briefing, 'acknowledged')}
            className="h-8 gap-1.5 text-xs"
          >
            <Check className="h-3.5 w-3.5" />
            {t('aiOps.actions.acknowledge')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={statusUpdating === `${briefing.briefing_id}:resolved`}
          onClick={() => void changeBriefingStatus(briefing, 'resolved')}
          className="h-8 gap-1.5 text-xs"
        >
          <Check className="h-3.5 w-3.5" />
          {t('aiOps.actions.resolve')}
        </Button>
      </>
    );
  };

  if (loading) {
    return <p className="text-xs text-foreground/60">{t('aiOps.loading')}</p>;
  }

  if (briefings.length === 0) {
    return (
      <div className="rounded-md border border-agent/20 bg-agent/5 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-agent/20 bg-agent/10">
            <Sparkles className="h-3.5 w-3.5 text-agent" />
          </span>
          <div>
            {emptyEyebrow && (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-agent">
                {emptyEyebrow}
              </p>
            )}
            <p className="text-sm font-semibold text-foreground">
              {emptyTitle ?? t('aiOps.emptyTitle')}
            </p>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-foreground/65">
              {emptyDescription ?? t('aiOps.emptyDescription')}
            </p>
            {emptyActions && <div className="mt-3 flex flex-wrap gap-2">{emptyActions}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {visibleBriefings.map((briefing) => (
          <div
            key={briefing.briefing_id}
            className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle/40 p-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <button
                type="button"
                onClick={() => void openBriefing(briefing)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                      severityClass(briefing.severity),
                    )}
                  >
                    {t(`aiOps.severity.${briefing.severity}`)}
                  </span>
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                      statusClass(briefing.status),
                    )}
                  >
                    {t(`aiOps.status.${briefing.status}`)}
                  </span>
                  {showScope && (
                    <span className="ol-mono truncate text-[10.5px] text-foreground/50">
                      {briefing.service_id ?? briefing.project_id}
                    </span>
                  )}
                </div>
                <div className="mt-2 truncate text-xs font-medium text-foreground">
                  {localizedBriefingTitle(briefing, t)}
                </div>
                <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-foreground/70">
                  {localizedBriefingSummary(briefing, t)}
                </p>
              </button>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => copyAgentHandoff(briefing)}
                  className="h-8 gap-1.5 bg-agent text-xs text-white hover:bg-agent/90"
                >
                  {isCopied(`ai-ops-handoff-${briefing.briefing_id}`) ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {isCopied(`ai-ops-handoff-${briefing.briefing_id}`)
                    ? t('aiOps.agentHandoff.copied')
                    : t('aiOps.actions.openInAgent')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyVerificationCall(briefing)}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isCopied(`ai-ops-verify-${briefing.briefing_id}`) ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {isCopied(`ai-ops-verify-${briefing.briefing_id}`)
                    ? t('aiOps.actions.verifyCopied')
                    : t('aiOps.actions.verifyAfterFix')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void openBriefing(briefing)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {t('aiOps.actions.viewEvidence')}
                </Button>
                {renderStatusActions(briefing)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={selectedBriefing !== null}
        onOpenChange={(open) => !open && setSelectedBriefing(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedBriefing
                ? localizedBriefingTitle(selectedBriefing, t)
                : t('aiOps.detailTitle')}
            </DialogTitle>
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
                  {t(`aiOps.severity.${selectedBriefing.severity}`)}
                </span>
                <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
                  {localizedBriefingClassification(selectedBriefing, t)}
                </span>
                {detailLoading && (
                  <span className="text-[11px] text-foreground/60">{t('aiOps.loading')}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => copyAgentHandoff(selectedBriefing)}
                  className="h-8 gap-1.5 bg-agent text-xs text-white hover:bg-agent/90"
                >
                  {isCopied(`ai-ops-handoff-${selectedBriefing.briefing_id}`) ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {isCopied(`ai-ops-handoff-${selectedBriefing.briefing_id}`)
                    ? t('aiOps.agentHandoff.copied')
                    : t('aiOps.actions.openInAgent')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyVerificationCall(selectedBriefing)}
                  className="h-8 gap-1.5 text-xs"
                >
                  {isCopied(`ai-ops-verify-${selectedBriefing.briefing_id}`) ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {isCopied(`ai-ops-verify-${selectedBriefing.briefing_id}`)
                    ? t('aiOps.actions.verifyCopied')
                    : t('aiOps.actions.verifyAfterFix')}
                </Button>
                {renderStatusActions(selectedBriefing)}
              </div>
              <p className="text-sm leading-relaxed text-foreground/80">
                {localizedBriefingSummary(selectedBriefing, t)}
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
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-foreground/80">
                      {t('aiOps.agentHandoff.title')}
                    </div>
                    <p className="mt-1 text-[11px] text-foreground/60">
                      {t('aiOps.agentHandoff.description')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => copyAgentHandoff(selectedBriefing)}
                    className="h-8 shrink-0 gap-1.5 text-xs"
                  >
                    {isCopied(`ai-ops-handoff-${selectedBriefing.briefing_id}`) ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {isCopied(`ai-ops-handoff-${selectedBriefing.briefing_id}`)
                      ? t('aiOps.agentHandoff.copied')
                      : t('aiOps.agentHandoff.copy')}
                  </Button>
                </div>
                <pre className="max-h-48 overflow-auto rounded-md border border-agent/20 bg-agent/5 p-3 text-[11px] text-foreground/80">
                  {buildAiOpsAgentHandoffPrompt(selectedBriefing)}
                </pre>
              </div>
              <CodeBlock
                label={t('aiOps.evidence')}
                value={formatJson(selectedBriefing.evidence)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
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
