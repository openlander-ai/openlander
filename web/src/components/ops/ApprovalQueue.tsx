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

export function ApprovalQueue({ projectId, projectNameById }: ApprovalQueueProps) {
  const { t } = useLanguage();
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

  if (!loading && sortedApprovals.length === 0) {
    return null;
  }

  return (
    <Card className="border-border bg-panel p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          {t('operations.approvals.title')}
        </h2>
        <Badge variant="outline" className="font-mono text-[11px] text-secondary-ol">
          {sortedApprovals.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {sortedApprovals.map((approval) => {
          const toolName = approval.approval_tool ?? 'unknown_tool';
          const riskTone = getRiskTone(toolName);
          const requestedAt = approval.approval_requested_at ?? approval.created_at;

          return (
            <div
              key={approval.id}
              className={cn(
                'rounded-lg border bg-bg-subtle p-4',
                riskTone === 'destructive' && 'border-error/50',
                riskTone === 'diagnostic' && 'border-agent/50',
                riskTone === 'neutral' && 'border-border',
              )}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-body text-xs text-secondary-ol">
                      {projectNameById[approval.project_id] ?? approval.project_id}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      {toolName}
                    </Badge>
                  </div>

                  <p className="font-body text-xs text-muted-ol">
                    {new Date(requestedAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleDecision(approval, 'approve')}
                    disabled={submittingId === approval.id}
                  >
                    {t('operations.approvals.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleDecision(approval, 'reject')}
                    disabled={submittingId === approval.id}
                  >
                    {t('operations.approvals.reject')}
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
