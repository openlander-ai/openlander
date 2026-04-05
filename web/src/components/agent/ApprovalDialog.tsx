import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  approveActionRun,
  fetchPendingApprovals,
  rejectActionRun,
  listProjects,
  type ActionRun,
} from '@/lib/api/projects';
import { ShieldAlert, Activity, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/i18n/context';

export function ApprovalDialog() {
  const { t } = useLanguage();
  const [pending, setPending] = useState<ActionRun | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectsMap, setProjectsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    async function initProjects() {
      try {
        const projs = await listProjects(true);
        const map: Record<string, string> = {};
        for (const p of projs) {
          map[p.id] = p.name;
        }
        setProjectsMap(map);
      } catch (err) {
        console.error('Failed to load projects for ApprovalDialog', err);
      }
    }
    void initProjects();
  }, []);

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

  const location = useLocation();

  if (!pending || location.pathname === '/operations') {
    return null;
  }

  const projectName = pending.project_id
    ? projectsMap[pending.project_id] || pending.project_id.substring(0, 8)
    : 'System';

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[400px] sm:w-[450px] rounded-xl border border-border bg-bg-panel shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300">
      {/* Header section */}
      <div className="bg-error/10 border-b border-error/20 p-4 pb-3 flex items-start gap-3">
        <div className="bg-error/20 p-2 rounded-full shrink-0">
          <ShieldAlert className="h-5 w-5 text-error" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-error mb-1">{t('agent.approval.title')}</h3>
          <p className="text-xs text-secondary-ol font-medium">
            <span className="font-mono bg-bg-subtle px-1 rounded mr-1.5">{projectName}</span>
            {t('agent.approval.description', { tool: toolName })}
          </p>
        </div>
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
            <h4 className="text-[11px] font-semibold text-muted-ol uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3 w-3" /> Incident Context
            </h4>
            <div className="bg-bg-subtle/50 border border-border p-2.5 rounded-md text-xs font-mono text-error whitespace-pre-wrap max-h-[80px] overflow-y-auto">
              {pending.error_message}
            </div>
          </div>
        )}

        {pending.plan && (
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-semibold text-muted-ol uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 text-agent" /> AI Recovery Plan
            </h4>
            <div className="bg-agent/5 border border-agent/20 p-2.5 rounded-md text-xs font-body text-secondary-ol leading-relaxed max-h-[100px] overflow-y-auto">
              {pending.plan}
            </div>
          </div>
        )}
      </div>

      {/* Action section */}
      <div className="p-4 pt-0 flex gap-3 mt-auto">
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
      </div>
    </div>
  );
}
