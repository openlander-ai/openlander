import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import type { PendingApproval } from '@/lib/api/usage';

export interface ApprovalBannerProps {
  approvals: PendingApproval[];
  onApprove: (projectId: string, actionRunId: string) => Promise<void>;
  onReject: (projectId: string, actionRunId: string) => Promise<void>;
}

export function ApprovalBanner({ approvals, onApprove, onReject }: ApprovalBannerProps) {
  const { t } = useLanguage();

  if (!approvals || approvals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col w-full" data-testid="approval-banner">
      {approvals.map((approval) => (
        <div
          key={approval.metadata.actionRunId}
          className={cn(
            'flex items-center justify-between px-4 py-3 border-b',
            'bg-warning/10 border-warning/20 text-warning-foreground',
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 p-1.5 rounded-md bg-warning/20 text-warning">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{t('approval.banner.title')}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-md bg-warning/20 text-warning font-medium">
                  {approval.metadata.toolName}
                </span>
              </div>
              <div className="text-xs opacity-80 truncate mt-0.5">
                <span className="font-medium">{t('approval.banner.project')}:</span>{' '}
                {approval.metadata.projectName} <span className="mx-1.5 opacity-50">•</span>
                <span className="font-medium">{t('approval.banner.attempt')}:</span>{' '}
                {approval.metadata.attempt}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <Button
              variant="destructive"
              size="sm"
              className="text-xs h-8"
              onClick={() =>
                void onReject(approval.metadata.projectId, approval.metadata.actionRunId).catch(
                  console.error,
                )
              }
            >
              {t('approval.banner.reject')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-warning hover:bg-warning/90 text-warning-foreground text-xs h-8"
              onClick={() =>
                void onApprove(approval.metadata.projectId, approval.metadata.actionRunId).catch(
                  console.error,
                )
              }
            >
              {t('approval.banner.approve')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
