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
import { fetchWithAuth } from '@/lib/api/auth';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  ShieldAlert,
  History,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { parseTimestamp } from '@/lib/time';
import { SeverityBadge } from '../ops/SeverityBadge';
import { useLanguage } from '@/i18n/context';

interface AgentActiveState {
  isActive: boolean;
  projectId?: string;
  projectName?: string;
  currentStep?: string;
  currentStepNumber?: number;
  totalSteps?: number;
  startedAt?: string;
}

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
  const [agentState, setAgentState] = useState<AgentActiveState | null>(null);

  usePollingTask(
    useCallback(async () => {
      try {
        const res = await fetchWithAuth('/api/ops/agent/active').catch(() => null);
        if (!res || !res.ok) {
          setAgentState(null);
          return;
        }
        const payload: AgentActiveState = await res.json();
        if (payload.isActive && payload.projectId === projectId) {
          setAgentState(payload);
        } else {
          setAgentState(null);
        }
      } catch {
        setAgentState(null);
      }
    }, [projectId]),
    { intervalMs: 5000 },
  );

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
        <p className="text-sm font-medium text-foreground">{t(error)}</p>
        <Button variant="outline" className="mt-4" onClick={fetchData}>
          {t('recoveryTab.retry')}
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
      {agentState && (
        <Card className="p-5 bg-agent/5 border-agent/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-agent/10 rounded-lg">
              <Loader2 className="h-5 w-5 text-agent animate-spin" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('recovery.activeRecovery')}
              </h3>
              {agentState.startedAt && (
                <p className="text-xs text-muted-foreground">
                  {t('recovery.agentStarted').replace(
                    '{time}',
                    parseTimestamp(agentState.startedAt)?.toLocaleTimeString() ?? '',
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RefreshCw className="h-4 w-4 text-agent shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground/80">
                {agentState.currentStepNumber && agentState.totalSteps
                  ? t('recovery.agentStep')
                      .replace('{current}', String(agentState.currentStepNumber))
                      .replace('{total}', String(agentState.totalSteps))
                      .replace('{description}', agentState.currentStep ?? '')
                  : (agentState.currentStep ?? t('recovery.agentAnalyzing'))}
              </p>
              {agentState.currentStepNumber != null && agentState.totalSteps != null && (
                <div className="mt-2 h-1.5 w-full bg-bg-subtle rounded-full overflow-hidden">
                  <div
                    className="h-full bg-agent rounded-full transition-all duration-500"
                    style={{
                      width: `${(agentState.currentStepNumber / agentState.totalSteps) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SECTION 1: Incident/Recovery History */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <History className="h-5 w-5 text-agent" />
          <h2 className="text-lg font-semibold text-foreground">{t('recovery.incidentHistory')}</h2>
        </div>
        {incidents.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-foreground">{t('recovery.noIncidents')}</p>
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
                  <span className="text-sm font-medium text-foreground/80">
                    {incident.title || `Incident ${incident.id.slice(0, 16)}`}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
          <h2 className="text-lg font-semibold text-foreground">{t('recovery.postmortems')}</h2>
        </div>
        {postmortems.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-foreground">{t('recovery.noPostmortems')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {postmortems.map((pm) => (
              <Card key={pm.id} className="p-4 bg-bg-panel">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-foreground">
                    {t('recoveryTab.postmortemReport')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {parseTimestamp(String(pm.created_at))?.toLocaleString()}
                  </span>
                </div>
                <pre className="text-xs text-foreground/80 whitespace-pre-wrap bg-bg-app p-3 rounded border border-[hsl(var(--border))]">
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
          <h2 className="text-lg font-semibold text-foreground">
            {t('recovery.pendingApprovals')}
          </h2>
        </div>
        {approvals.length === 0 ? (
          <Card className="p-8 text-center border-dashed bg-bg-panel/50">
            <p className="text-sm text-muted-foreground">{t('recovery.noApprovals')}</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <Card
                key={approval.metadata.actionRunId}
                className="p-4 bg-bg-panel flex items-center justify-between"
              >
                <div>
                  <h3 className="text-sm font-medium text-foreground mb-1">
                    {approval.metadata.toolName}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t('recoveryTab.attempt')} {approval.metadata.attempt} •{' '}
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
                    {t('recoveryTab.reject')}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => handleApprove(approval.metadata.actionRunId)}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    {t('recoveryTab.approve')}
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
