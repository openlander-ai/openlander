import { useEffect, useState } from 'react';
import { ShieldCheck, Check, X, Loader2 } from 'lucide-react';
import { getPendingApprovals, approveRecovery, rejectRecovery } from '@/lib/api/usage';
import type { PendingApproval } from '@/lib/api/usage';
import { Skeleton } from '@/components/ui/skeleton';
import { parseTimestamp, formatRelativeTime } from '@/lib/time';
import { useLanguage } from '@/i18n/context';

export function ApprovalsTab() {
  const { t } = useLanguage();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchApprovals = async () => {
    try {
      const data = await getPendingApprovals();
      setApprovals(data);
    } catch (error) {
      console.error('Failed to fetch approvals:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, []);

  const handleApprove = async (projectId: string, actionRunId: string) => {
    setProcessingId(actionRunId);
    try {
      await approveRecovery(projectId, actionRunId);
      await fetchApprovals();
    } catch (error) {
      console.error('Failed to approve:', error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (projectId: string, actionRunId: string) => {
    setProcessingId(actionRunId);
    try {
      await rejectRecovery(projectId, actionRunId);
      await fetchApprovals();
    } catch (error) {
      console.error('Failed to reject:', error);
    } finally {
      setProcessingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed border-[hsl(var(--border))] rounded-lg m-6 bg-bg-subtle/30">
        <ShieldCheck className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          {t('approvalsTab.noPendingApprovals')}
        </h3>
        <p className="text-sm text-muted-foreground max-w-md">{t('approvalsTab.emptyMessage')}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {approvals.map((approval) => {
        const { projectId, projectName, toolName, actionRunId, createdAt } = approval.metadata;
        const isProcessing = processingId === actionRunId;
        const date = parseTimestamp(String(createdAt));

        return (
          <div
            key={actionRunId}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-foreground">{projectName}</span>
                <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-bg-subtle">
                  {toolName}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('approvalsTab.requested')}{' '}
                {formatRelativeTime(String(createdAt), t) ||
                  (date ? date.toLocaleString() : 'Unknown time')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleReject(projectId, actionRunId)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-error hover:bg-error/10 rounded-md transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                {t('approvalsTab.reject')}
              </button>
              <button
                onClick={() => handleApprove(projectId, actionRunId)}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-success hover:bg-success/90 rounded-md transition-colors disabled:opacity-50"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                {t('approvalsTab.approve')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
