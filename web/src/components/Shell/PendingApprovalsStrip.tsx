import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePendingApprovals } from '@/hooks/use-pending-approvals';
import { useLanguage } from '@/i18n/context';
import {
  ACTION_RUN_RESOLVED_EVENT,
  approveActionRun,
  rejectActionRun,
  type ActionRunResolvedDetail,
  type PendingApproval,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { localizeApiError } from '@/lib/localized-api-error';

const RECENTLY_RESOLVED_MS = 5_000;
const DETAIL_ORDER = ['keys', 'key', 'filename', 'path', 'name', 'service_name', 'project_name'];

function formatApprovalDetailValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && !!item);
    return items.length > 0 ? items.join(', ') : null;
  }
  if (typeof value === 'string' && value) return value;
  return null;
}

function describeApproval(approval: PendingApproval): string | null {
  const details = approval.metadata.details;
  if (!details) return null;

  const ordered = [
    ...DETAIL_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(details, key)),
    ...Object.keys(details).filter((key) => !DETAIL_ORDER.includes(key)),
  ];
  const parts = ordered
    .map((key) => {
      const value = formatApprovalDetailValue(details[key]);
      return value ? `${key}: ${value}` : null;
    })
    .filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function describeApprovalActor(approval: PendingApproval): string | null {
  const actor = approval.metadata.actor;
  if (!actor) return null;

  const parts = [
    actor.initiatedBy,
    actor.tokenType,
    actor.scopeKind === 'project' && actor.scopeProjectId
      ? `project:${shortId(actor.scopeProjectId)}`
      : actor.scopeKind,
    actor.tokenId ? `token:${shortId(actor.tokenId)}` : null,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function describeApprovalTarget(approval: PendingApproval): string {
  return approval.metadata.projectName ?? approval.metadata.projectId ?? 'OpenLander';
}

export function PendingApprovalsStrip() {
  const { t } = useLanguage();
  const { approvals, loading, error, refetch } = usePendingApprovals();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [recentlyResolved, setRecentlyResolved] = useState<Set<string>>(() => new Set());
  const resolvedTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const timer of resolvedTimers.current.values()) {
        clearTimeout(timer);
      }
      resolvedTimers.current.clear();
    };
  }, []);

  const visibleApprovals = useMemo(
    () => approvals.filter((approval) => !recentlyResolved.has(approval.metadata.actionRunId)),
    [approvals, recentlyResolved],
  );
  const panelId = 'pending-approvals-panel';
  const firstApproval = visibleApprovals[0] ?? null;

  useEffect(() => {
    if (visibleApprovals.length === 0) setExpanded(false);
  }, [visibleApprovals.length]);

  function suppressResolvedApproval(actionRunId: string) {
    setRecentlyResolved((current) => {
      const next = new Set(current);
      next.add(actionRunId);
      return next;
    });

    const existingTimer = resolvedTimers.current.get(actionRunId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      resolvedTimers.current.delete(actionRunId);
      setRecentlyResolved((current) => {
        if (!current.has(actionRunId)) return current;
        const next = new Set(current);
        next.delete(actionRunId);
        return next;
      });
    }, RECENTLY_RESOLVED_MS);
    resolvedTimers.current.set(actionRunId, timer);
  }

  const handleDecision = async (approval: PendingApproval, approved: boolean) => {
    const actionRunId = approval.metadata.actionRunId;
    setBusyId(actionRunId);
    try {
      if (approved) await approveActionRun(actionRunId);
      else await rejectActionRun(actionRunId);
      window.dispatchEvent(
        new CustomEvent<ActionRunResolvedDetail>(ACTION_RUN_RESOLVED_EVENT, {
          detail: { actionRunId, approved },
        }),
      );
      toast.success(
        approved ? t('approval.pendingStrip.approved') : t('approval.pendingStrip.rejected'),
      );
      suppressResolvedApproval(actionRunId);
      void refetch();
    } catch (err) {
      toast.error(localizeApiError(err, t, 'approval.pendingStrip.error', 'common.errors.codes'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading || visibleApprovals.length === 0) return null;

  return (
    <section
      role="region"
      aria-live="polite"
      aria-label={t('approval.pendingStrip.title')}
      className="mx-auto w-full max-w-3xl rounded-[var(--ol-radius)] border border-[color-mix(in_oklch,var(--ol-warning)_28%,var(--ol-border))] bg-[color-mix(in_oklch,var(--ol-warning)_6%,var(--ol-panel))] shadow-sm"
    >
      <div className="flex flex-col">
        <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--ol-warning)_16%,transparent)] text-[color:var(--ol-warning)]">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[color:var(--ol-fg)]">
                {visibleApprovals.length === 1
                  ? t('approval.pendingStrip.summaryOne')
                  : t('approval.pendingStrip.summaryMany', { count: visibleApprovals.length })}
              </h2>
              {firstApproval && (
                <p className="mt-0.5 truncate text-xs text-[color:var(--ol-fg-muted)]">
                  <span className="font-mono text-[color:var(--ol-fg)]">
                    {firstApproval.metadata.toolName}
                  </span>
                  <span> · {describeApprovalTarget(firstApproval)}</span>
                  <span> · {formatRelativeTime(firstApproval.createdAt, t)}</span>
                  <span>
                    {' '}
                    ·{' '}
                    {error
                      ? t('approval.pendingStrip.loadWarning')
                      : t('approval.pendingStrip.body')}
                  </span>
                </p>
              )}
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((value) => !value)}
            className="shrink-0"
          >
            {expanded ? t('approval.pendingStrip.hide') : t('approval.pendingStrip.review')}
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
          </Button>
        </div>

        {expanded && (
          <div id={panelId} className="space-y-2 border-t border-[color:var(--ol-border)] p-3">
            {visibleApprovals.slice(0, 5).map((approval) => {
              const actionRunId = approval.metadata.actionRunId;
              const detail = describeApproval(approval);
              const actor = describeApprovalActor(approval);
              const isAnyBusy = busyId !== null;
              return (
                <div
                  key={actionRunId}
                  className="flex flex-col gap-2 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 py-0.5 text-[10px] text-[color:var(--ol-fg-muted)]">
                        {approval.metadata.source === 'mcp'
                          ? t('approval.pendingStrip.mcpSource')
                          : t('approval.pendingStrip.recoverySource')}
                      </span>
                      <span className="font-mono text-xs text-[color:var(--ol-fg)]">
                        {approval.metadata.toolName}
                      </span>
                      <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
                        {formatRelativeTime(approval.createdAt, t)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-[color:var(--ol-fg)]">
                      {describeApprovalTarget(approval)}
                    </p>
                    {detail && (
                      <p className="mt-1 truncate text-xs text-[color:var(--ol-fg-muted)]">
                        {t('approval.pendingStrip.details')}{' '}
                        <span className="font-mono">{detail}</span>
                      </p>
                    )}
                    {actor && (
                      <p className="mt-1 truncate text-[11px] text-[color:var(--ol-fg-subtle)]">
                        {t('approval.pendingStrip.actor')}{' '}
                        <span className="font-mono">{actor}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isAnyBusy}
                      onClick={() => void handleDecision(approval, false)}
                    >
                      <X className="h-4 w-4" />
                      {t('approval.pendingStrip.reject')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isAnyBusy}
                      onClick={() => void handleDecision(approval, true)}
                      className="border border-[color-mix(in_oklch,var(--ol-warning)_60%,var(--ol-border))] bg-[color-mix(in_oklch,var(--ol-warning)_78%,var(--ol-panel))] text-[color:var(--ol-fg)] shadow-none hover:opacity-90"
                    >
                      <Check className="h-4 w-4" />
                      {t('approval.pendingStrip.approve')}
                    </Button>
                  </div>
                </div>
              );
            })}
            {visibleApprovals.length > 5 && (
              <p className="px-1 text-xs text-[color:var(--ol-fg-muted)]">
                {t('approval.pendingStrip.more', { count: visibleApprovals.length - 5 })}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
