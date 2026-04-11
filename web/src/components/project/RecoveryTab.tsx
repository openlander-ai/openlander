import { useState, useCallback } from 'react';
import { usePollingTask } from '@/hooks/use-polling-task';
import {
  fetchOpsIncidents,
  fetchPostmortems,
  type OpsIncident,
  type PostmortemEntry,
} from '@/lib/api/operations';
import {
  getPendingApprovals,
  approveRecovery,
  rejectRecovery,
  type PendingApproval,
} from '@/lib/api/usage';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, XCircle, FileText, ShieldAlert, History } from 'lucide-react';
import { parseTimestamp } from '@/lib/time';
import { SeverityBadge } from '../ops/SeverityBadge';
import { useLanguage } from '@/i18n/context';

interface RecoveryTabProps {
  projectId: string;
}

export function RecoveryTab({ projectId }: RecoveryTabProps) {
  const { t } = useLanguage();
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [postmortems, setPostmortems] = useState<PostmortemEntry[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [incidentsRes, postmortemsRes, approvalsRes] = await Promise.all([
        fetchOpsIncidents(projectId),
        fetchPostmortems(projectId),
        getPendingApprovals(),
      ]);

      setIncidents(incidentsRes.incidents || []);
      setPostmortems(postmortemsRes.postmortems || []);

      // Filter approvals for this project
      const projectApprovals = (approvalsRes || []).filter(
        (a) => a.metadata.projectId === projectId,
      );
      setApprovals(projectApprovals);
    } catch (err) {
      console.error('Failed to fetch recovery data:', err);
      setError('Failed to load recovery data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  usePollingTask(fetchData, { intervalMs: 10000 });

  const handleApprove = async (actionRunId: string) => {
    try {
      await approveRecovery(projectId, actionRunId);
      fetchData();
    } catch (err) {
      console.error('Failed to approve:', err);
    }
  };

  const handleReject = async (actionRunId: string) => {
    try {
      await rejectRecovery(projectId, actionRunId);
      fetchData();
    } catch (err) {
      console.error('Failed to reject:', err);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 bg-bg-app">
        <AlertTriangle className="h-8 w-8 mb-3 text-error" />
        <p className="text-sm font-medium text-primary-ol">{t(error)}</p>
        <Button variant="outline" className="mt-4" onClick={fetchData}>
          {t('Retry')}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full p-6 bg-bg-app space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-6 bg-bg-app overflow-auto space-y-8">
      {/* SECTION 1: Incident/Recovery History */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <History className="h-5 w-5 text-agent" />
          <h2 className="text-lg font-semibold text-primary-ol">{t('recovery.incidentHistory')}</h2>
        </div>
        {incidents.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-ol">{t('recovery.noIncidents')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {incidents.map((incident) => (
              <div
                key={incident.id}
                className="flex items-center justify-between p-4 bg-bg-panel border border-[hsl(var(--border))] rounded-lg shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <SeverityBadge severity={incident.severity} />
                  <span className="text-sm font-medium text-secondary-ol">
                    {incident.title || `Incident ${incident.id.slice(0, 16)}`}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-ol">
                  <span className="capitalize">{t(incident.status)}</span>
                  <span>{parseTimestamp(String(incident.created_at))?.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2: Postmortems */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-5 w-5 text-agent" />
          <h2 className="text-lg font-semibold text-primary-ol">{t('recovery.postmortems')}</h2>
        </div>
        {postmortems.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-ol">{t('recovery.noPostmortems')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {postmortems.map((pm) => (
              <Card key={pm.id} className="p-4 bg-bg-panel">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-primary-ol">Postmortem Report</span>
                  <span className="text-xs text-muted-ol">
                    {parseTimestamp(String(pm.created_at))?.toLocaleString()}
                  </span>
                </div>
                <pre className="text-xs text-secondary-ol whitespace-pre-wrap bg-bg-app p-3 rounded border border-[hsl(var(--border))]">
                  {pm.content}
                </pre>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 3: Pending Approvals */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="h-5 w-5 text-agent" />
          <h2 className="text-lg font-semibold text-primary-ol">
            {t('recovery.pendingApprovals')}
          </h2>
        </div>
        {approvals.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-ol">{t('recovery.noApprovals')}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <Card
                key={approval.metadata.actionRunId}
                className="p-4 bg-bg-panel flex items-center justify-between"
              >
                <div>
                  <h3 className="text-sm font-medium text-primary-ol mb-1">
                    {approval.metadata.toolName}
                  </h3>
                  <p className="text-xs text-muted-ol">
                    Attempt {approval.metadata.attempt} •{' '}
                    {parseTimestamp(String(approval.createdAt))?.toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-error hover:text-error hover:bg-error/10"
                    onClick={() => handleReject(approval.metadata.actionRunId)}
                  >
                    <XCircle className="h-4 w-4 mr-1.5" />
                    {t('Reject')}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => handleApprove(approval.metadata.actionRunId)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    {t('Approve')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
