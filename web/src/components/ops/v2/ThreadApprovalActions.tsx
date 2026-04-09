import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { ActivityItem } from '../../../lib/api/operations.js';
import { approveActionRun, rejectActionRun } from '../../../lib/api/projects.js';
import { getRiskTone } from '../utils.js';
import { Button } from '../../ui/button.js';
import { Badge } from '../../ui/badge.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approvals older than 10 minutes are considered timed out. */
const TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the tool name from an approval activity's title.
 * Backend format: "Approval required: <toolName>"
 */
function extractToolName(event: ActivityItem): string | null {
  const match = event.title.match(/^Approval required:\s*(.+)$/i);
  return match?.[1] ?? null;
}

function isTimedOut(event: ActivityItem): boolean {
  const eventTime = new Date(event.timestamp).getTime();
  return Date.now() - eventTime > TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ThreadApprovalActionsProps {
  events: ActivityItem[];
}

export function ThreadApprovalActions({ events }: ThreadApprovalActionsProps) {
  const { t } = useLanguage();
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [optimisticHidden, setOptimisticHidden] = useState<Set<string>>(new Set());
  const [confirmEvent, setConfirmEvent] = useState<ActivityItem | null>(null);

  const pendingApprovals = events.filter(
    (e) => e.type === 'approval' && e.status === 'pending' && !optimisticHidden.has(e.id),
  );

  const handleDecision = useCallback(
    async (event: ActivityItem, decision: 'approve' | 'reject') => {
      const actionRunId = event.actionRunId;
      if (!actionRunId) return;

      setSubmittingId(actionRunId);
      // Optimistic: hide immediately
      setOptimisticHidden((prev) => new Set(prev).add(event.id));

      try {
        if (decision === 'approve') {
          await approveActionRun(actionRunId);
          toast.success(t('opsV2.approvals.approved'));
        } else {
          await rejectActionRun(actionRunId);
          toast.success(t('opsV2.approvals.rejected'));
        }
      } catch {
        // Revert optimistic hide on error
        setOptimisticHidden((prev) => {
          const next = new Set(prev);
          next.delete(event.id);
          return next;
        });
        toast.error(t('opsV2.approvals.error'));
      } finally {
        setSubmittingId(null);
        setConfirmEvent(null);
      }
    },
    [t],
  );

  if (pendingApprovals.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col gap-2 border-t border-border/50 pt-3 mt-1">
        {pendingApprovals.map((event) => {
          const toolName = extractToolName(event);
          const riskTone = getRiskTone(toolName);
          const timedOut = isTimedOut(event);
          const isSubmitting = submittingId === event.actionRunId;

          return (
            <div
              key={event.id}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2',
                riskTone === 'destructive' && 'border-error/40 bg-error/5',
                riskTone === 'diagnostic' && 'border-agent/40 bg-agent/5',
                riskTone === 'neutral' && 'border-border bg-bg-subtle/30',
              )}
            >
              {/* Label */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {riskTone === 'destructive' && (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error" />
                )}
                <span className="truncate text-xs font-medium text-primary-ol">{event.title}</span>
                {timedOut && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-warning/40 text-[10px] text-warning"
                  >
                    {t('opsV2.approvals.timedOut')}
                  </Badge>
                )}
              </div>

              {/* Actions */}
              {!timedOut && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {isSubmitting ? (
                    <span className="text-[11px] text-muted-ol">
                      {t('opsV2.approvals.submitting')}
                    </span>
                  ) : riskTone === 'destructive' ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] hover:border-error/30 hover:bg-error/10 hover:text-error"
                        onClick={() => void handleDecision(event, 'reject')}
                      >
                        {t('opsV2.approvals.reject')}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 bg-error px-2 text-[11px] text-white hover:bg-error/90"
                        onClick={() => setConfirmEvent(event)}
                      >
                        {t('opsV2.approvals.approve')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px] hover:border-error/30 hover:bg-error/10 hover:text-error"
                        onClick={() => void handleDecision(event, 'reject')}
                      >
                        {t('opsV2.approvals.reject')}
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => void handleDecision(event, 'approve')}
                      >
                        {t('opsV2.approvals.approve')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Destructive confirmation dialog */}
      <Dialog
        open={!!confirmEvent}
        onOpenChange={(open) => {
          if (!open) setConfirmEvent(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('opsV2.approvals.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('opsV2.approvals.confirmDescription', {
                action: confirmEvent ? (extractToolName(confirmEvent) ?? '') : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmEvent(null)}>
              {t('opsV2.approvals.confirmCancel')}
            </Button>
            <Button
              size="sm"
              className="bg-error text-white hover:bg-error/90"
              disabled={submittingId === confirmEvent?.actionRunId}
              onClick={() => {
                if (confirmEvent) void handleDecision(confirmEvent, 'approve');
              }}
            >
              {submittingId === confirmEvent?.actionRunId
                ? t('opsV2.approvals.submitting')
                : t('opsV2.approvals.confirmApprove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
