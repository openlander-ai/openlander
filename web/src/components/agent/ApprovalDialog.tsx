import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { approveActionRun, rejectActionRun } from '@/lib/api/projects';
import { ShieldAlert, Activity, CheckCircle2, X } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { TOOL_HUMAN_LABELS } from '@/components/ops/utils';
import { useAppData } from '@/hooks/use-app-data';

export function ApprovalDialog() {
  const { t, language } = useLanguage();
  const { pendingApprovals, pendingApprovalsError, refreshPendingApprovals, projects } =
    useAppData();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const projectsMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects) {
      map[p.id] = p.name;
    }
    return map;
  }, [projects]);

  const pending = pendingApprovals[0] ?? null;
  const remainingCount = pendingApprovals.length - 1;
  const error = actionError ?? (pendingApprovalsError ? t('agent.approval.loadFailed') : null);

  const toolName = useMemo(() => {
    const rawTool = pending?.approval_tool ?? 'unknown_tool';
    const toolData = TOOL_HUMAN_LABELS[rawTool.toLowerCase()];
    if (toolData) {
      return toolData[language as 'en' | 'ko'] ?? rawTool;
    }
    return rawTool;
  }, [pending?.approval_tool, language]);

  const handleApprove = useCallback(async () => {
    if (!pending) {
      return;
    }

    setIsSubmitting(true);
    try {
      await approveActionRun(pending.id);
      setActionError(null);
      await refreshPendingApprovals();
    } catch {
      setActionError(t('agent.approval.actionFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [pending, refreshPendingApprovals, t]);

  const handleReject = useCallback(async () => {
    if (!pending) {
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectActionRun(pending.id);
      setActionError(null);
      await refreshPendingApprovals();
    } catch {
      setActionError(t('agent.approval.actionFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [pending, refreshPendingApprovals, t]);

  useEffect(() => {
    setDismissed(false);
  }, [pending?.id]);

  if (!pending || dismissed) {
    return null;
  }

  const projectName = pending.project_id
    ? projectsMap[pending.project_id] || pending.project_id.substring(0, 8)
    : 'System';

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[450px] rounded-xl border border-border bg-bg-panel shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300">
      {/* Header section */}
      <div className="bg-error/10 border-b border-error/20 p-4 pb-3 flex items-start gap-3">
        <div className="bg-error/20 p-2 rounded-full shrink-0">
          <ShieldAlert className="h-5 w-5 text-error" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-error mb-1">{t('agent.approval.title')}</h3>
          <p className="text-xs text-foreground/80 font-medium">
            <span className="font-mono bg-bg-subtle px-1 rounded mr-1.5">{projectName}</span>
            {t('agent.approval.description', { tool: toolName })}
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 p-1 rounded-md hover:bg-error/10 transition-colors"
          title="Dismiss"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Context section */}
      <div className="p-4 space-y-4">
        {error ? (
          <div className="bg-error/5 border border-error/20 p-2 rounded text-xs text-error">
            {error}
          </div>
        ) : null}

        {pending.error_message && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> {t('agent.approval.incidentContext')}
            </h4>
            <div className="bg-bg-subtle/50 border border-border p-2.5 rounded-md text-xs font-mono text-error whitespace-pre-wrap max-h-[80px] overflow-y-auto">
              {pending.error_message}
            </div>
          </div>
        )}

        {pending.plan && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-agent" /> {t('agent.approval.recoveryPlan')}
            </h4>
            <div className="bg-agent/5 border border-agent/20 p-2.5 rounded-md text-xs font-body text-foreground/80 leading-relaxed max-h-[100px] overflow-y-auto whitespace-pre-wrap">
              {pending.plan}
            </div>
          </div>
        )}

        {pending.recovery_strategy && pending.recovery_strategy !== 'unknown' && (
          <div className="flex items-center gap-1.5 text-xs text-agent font-medium">
            <span>🤖</span>
            <span>
              {pending.recovery_strategy === 'llm'
                ? t('ops.recoveryStrategy.llm')
                : pending.recovery_strategy === 'memory'
                  ? t('ops.recoveryStrategy.memory')
                  : t('ops.recoveryStrategy.recipe')}
            </span>
          </div>
        )}
      </div>

      {/* Action section */}
      <div className="p-4 pt-0 flex items-center gap-3 mt-auto">
        <Button size="sm" onClick={() => void handleApprove()} disabled={isSubmitting}>
          {t('agent.approval.approve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleReject()}
          disabled={isSubmitting}
        >
          {t('agent.approval.reject')}
        </Button>

        {remainingCount > 0 && (
          // Static count — no destination page exists in 1.0; the dialog
          // cycles through pending approvals one at a time as the user
          // resolves them. Was a navigate-to-/operations button in v1
          // but /operations was retired (ralplan Phase 1).
          <span className="ml-auto text-[11px] text-agent">
            {t('agent.approval.pendingMore', { count: String(remainingCount) })}
          </span>
        )}
      </div>
    </div>
  );
}
