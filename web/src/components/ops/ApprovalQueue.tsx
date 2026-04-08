import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  approveActionRun,
  fetchPendingApprovals,
  rejectActionRun,
  type ActionRun,
} from '@/lib/api/projects';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { TOOL_HUMAN_LABELS } from '@/components/ops/utils';
interface ApprovalQueueProps {
  projectId?: string;
  projectNameById: Record<string, string>;
}

function getRiskTone(toolName: string | null): 'destructive' | 'diagnostic' | 'neutral' {
  if (!toolName) {
    return 'neutral';
  }

  const normalized = toolName.toLowerCase();
  if (
    normalized.includes('rollback') ||
    normalized.includes('stop') ||
    normalized.includes('delete') ||
    normalized.includes('purge') ||
    normalized.includes('remove')
  ) {
    return 'destructive';
  }

  if (
    normalized.includes('diagnose') ||
    normalized.includes('debug') ||
    normalized.includes('inspect') ||
    normalized.includes('status') ||
    normalized.includes('log')
  ) {
    return 'diagnostic';
  }

  return 'neutral';
}

function getRecoveryStrategyLabel(strategy: string | null, t: (key: string) => string) {
  switch (strategy) {
    case 'llm':
      return t('ops.recoveryStrategy.llm');
    case 'memory':
      return t('ops.recoveryStrategy.memory');
    case 'recipe':
      return t('ops.recoveryStrategy.recipe');
    default:
      return t('ops.recoveryStrategy.unknown');
  }
}

export function ApprovalQueue({ projectId, projectNameById }: ApprovalQueueProps) {
  const { t, language } = useLanguage();
  const [approvals, setApprovals] = useState<ActionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    try {
      const all = await fetchPendingApprovals();
      const filtered = projectId ? all.filter((item) => item.project_id === projectId) : all;
      setApprovals(filtered);
    } catch (err) {
      console.error('Failed to load pending approvals', err);
      toast.error(t('agent.approval.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    setLoading(true);
    void loadApprovals();
  }, [loadApprovals]);

  const sortedApprovals = useMemo(() => {
    return [...approvals].sort((a, b) => {
      const aTime = new Date(a.approval_requested_at ?? a.created_at).getTime();
      const bTime = new Date(b.approval_requested_at ?? b.created_at).getTime();
      return bTime - aTime;
    });
  }, [approvals]);

  const handleDecision = async (approval: ActionRun, decision: 'approve' | 'reject') => {
    setSubmittingId(approval.id);
    try {
      if (decision === 'approve') {
        await approveActionRun(approval.id);
        toast.success(t('approval.banner.approved'));
      } else {
        await rejectActionRun(approval.id);
        toast.success(t('approval.banner.rejected'));
      }
      setApprovals((prev) => prev.filter((item) => item.id !== approval.id));
    } catch (err) {
      console.error('Failed to process approval decision', err);
      toast.error(t('approval.banner.error'));
    } finally {
      setSubmittingId(null);
    }
  };

  const activeApprovals = sortedApprovals.filter(
    (approval) => !!projectNameById[approval.project_id],
  );

  if (!loading && activeApprovals.length === 0) {
    return null;
  }

  return (
    <Card className="border-border bg-panel p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          {t('operations.approvals.title')}
        </h2>
        <Badge variant="outline" className="font-mono text-[11px] text-secondary-ol">
          {activeApprovals.length}
        </Badge>
      </div>

      <div className="space-y-4">
        {activeApprovals.map((approval) => {
          const toolName = approval.approval_tool ?? 'unknown_tool';
          const normalizedToolName = toolName.toLowerCase();
          const riskTone = getRiskTone(toolName);
          const requestedAt = approval.approval_requested_at ?? approval.created_at;
          const projectName = projectNameById[approval.project_id]!; // Guaranteed to exist by filter

          const fallbackLabel = language === 'ko' ? `${toolName} 실행 요청` : `${toolName} request`;
          const toolData = TOOL_HUMAN_LABELS[normalizedToolName];
          const actionLabel = toolData ? toolData[language] : fallbackLabel;
          const actionImpact = toolData
            ? toolData[`impact_${language}` as 'impact_ko' | 'impact_en']
            : '';

          return (
            <div
              key={approval.id}
              className={cn(
                'rounded-xl border bg-bg-panel p-5 shadow-sm transition-shadow hover:shadow-md flex flex-col gap-4',
                riskTone === 'destructive' && 'border-error/50',
                riskTone === 'diagnostic' && 'border-agent/50',
                riskTone === 'neutral' && 'border-border',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-error mt-0.5">🔴</span>
                <h3 className="font-display font-semibold text-primary-ol text-sm">
                  <span className="font-bold">{projectName}</span>{' '}
                  <span className="text-secondary-ol">—</span> {actionLabel}
                </h3>
              </div>

              <div className="flex flex-col gap-3 rounded-lg bg-bg-subtle/50 px-4 py-3 border border-border/50">
                {approval.plan && (
                  <div className="flex items-start gap-3">
                    <span className="text-secondary-ol pt-0.5">📋</span>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-xs font-semibold text-secondary-ol mb-1">
                        {language === 'ko' ? '상황 요약' : 'Context'}
                      </span>
                      <pre className="text-xs font-mono text-primary-ol leading-relaxed break-words whitespace-pre-wrap max-h-32 overflow-y-auto pr-2 custom-scrollbar bg-bg-app/50 rounded-md p-2 border border-border/30">
                        {approval.plan}
                      </pre>
                    </div>
                  </div>
                )}

                {!approval.plan && approval.error_message && (
                  <div className="flex items-start gap-3">
                    <span className="text-secondary-ol pt-0.5">📋</span>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-secondary-ol mb-0.5">
                        {language === 'ko' ? '원인' : 'Cause'}
                      </span>
                      <p className="text-xs font-mono text-primary-ol leading-relaxed break-words max-h-24 overflow-y-auto pr-2 custom-scrollbar">
                        {approval.error_message}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <span className="text-secondary-ol">🔄</span>
                  <span className="text-xs font-body text-primary-ol">{actionLabel}</span>
                  {actionImpact && (
                    <>
                      <span className="text-border">·</span>
                      <span className="text-xs font-body text-muted-ol">{actionImpact}</span>
                    </>
                  )}
                </div>

                {approval.recovery_strategy && (
                  <div className="flex items-center gap-3">
                    <span className="text-agent">🤖</span>
                    <span className="text-xs font-semibold text-agent">
                      {getRecoveryStrategyLabel(approval.recovery_strategy, t)}
                    </span>
                    {approval.current_step && approval.total_steps && (
                      <span className="text-xs font-body text-secondary-ol">
                        ({approval.current_step}/{approval.total_steps})
                      </span>
                    )}
                  </div>
                )}
              </div>

              {riskTone === 'destructive' && (
                <div className="flex items-center gap-2 bg-error/5 border border-error/20 p-2.5 rounded-md px-3">
                  <span className="text-error text-sm">⚠️</span>
                  <span className="text-xs font-medium text-error">
                    {language === 'ko'
                      ? '이 작업은 서비스를 일시 중단시킬 수 있습니다.'
                      : 'This action may cause downtime.'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between mt-2 pt-3 border-t border-border">
                <div className="flex items-center gap-2 text-xs font-body text-muted-ol">
                  <span>{new Date(requestedAt).toLocaleTimeString()}</span>
                  <span>·</span>
                  <span className="font-mono">{approval.trigger_source ?? 'unknown_source'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="hover:bg-error/10 hover:text-error hover:border-error/30"
                    onClick={() => void handleDecision(approval, 'reject')}
                    disabled={submittingId === approval.id}
                  >
                    {t('operations.approvals.reject')}
                  </Button>
                  <Button
                    size="sm"
                    className={cn(
                      riskTone === 'destructive' ? 'bg-error hover:bg-error/90 text-white' : '',
                    )}
                    onClick={() => void handleDecision(approval, 'approve')}
                    disabled={submittingId === approval.id}
                  >
                    {t('operations.approvals.approve')}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
