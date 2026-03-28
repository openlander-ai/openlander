import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  approveActionRun,
  fetchPendingApprovals,
  rejectActionRun,
  type ActionRun,
} from '@/lib/api/projects';
import { useLanguage } from '@/i18n/context';

export function ApprovalDialog() {
  const { t } = useLanguage();
  const [pending, setPending] = useState<ActionRun | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPending = useCallback(async () => {
    try {
      const runs = await fetchPendingApprovals();
      setPending(runs[0] ?? null);
      setError(null);
    } catch {
      setError(t('agent.approval.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refreshPending();
    const interval = setInterval(() => {
      void refreshPending();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [refreshPending]);

  const toolName = useMemo(
    () => pending?.approval_tool ?? 'unknown_tool',
    [pending?.approval_tool],
  );

  const handleApprove = useCallback(async () => {
    if (!pending) {
      return;
    }

    setIsSubmitting(true);
    try {
      await approveActionRun(pending.id);
      await refreshPending();
    } catch {
      setError(t('agent.approval.actionFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [pending, refreshPending, t]);

  const handleReject = useCallback(async () => {
    if (!pending) {
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectActionRun(pending.id);
      await refreshPending();
    } catch {
      setError(t('agent.approval.actionFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [pending, refreshPending, t]);

  if (!pending) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] rounded-lg border border-border bg-bg-panel p-4 shadow-lg">
      <h3 className="mb-2 text-sm font-semibold text-primary-ol">{t('agent.approval.title')}</h3>
      <p className="mb-3 text-xs text-muted-ol">
        {t('agent.approval.description', { tool: toolName })}
      </p>

      {error ? <p className="mb-3 text-xs text-error">{error}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" onClick={() => void handleApprove()} disabled={isSubmitting}>
          {t('agent.approval.approve')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleReject()}
          disabled={isSubmitting}
        >
          {t('agent.approval.reject')}
        </Button>
      </div>
    </div>
  );
}
