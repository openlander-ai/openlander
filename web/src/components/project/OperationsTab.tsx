import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  fetchOpsIncidents,
  fetchCircuitBreakerState,
  resetCircuitBreaker,
  fetchOpsConfig,
  updateOpsConfig,
  type OpsIncident,
  type CircuitBreakerState,
  type OpsConfig,
} from '@/lib/api/operations';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import {
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  BellOff,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusHeroCard, type StatusType } from '../ops/StatusHeroCard.js';
import { SeverityBadge } from '../ops/SeverityBadge.js';
import { IncidentCard, type IncidentGroup } from '../ops/IncidentCard.js';
import { useLanguage } from '@/i18n/context.js';

interface OperationsTabProps {
  projectId: string;
  projectStatus?: 'running' | 'stopped' | 'building' | 'error' | 'idle';
}

import { humanizeEventType, humanizeDescription } from '../ops/utils.js';

function groupIncidents(incidents: OpsIncident[], t: (key: string) => string): IncidentGroup[] {
  const groups = new Map<string, OpsIncident[]>();
  for (const inc of incidents) {
    const typeKey =
      inc.triggerType ||
      (inc.title || inc.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    const key = `${inc.severity}::${typeKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inc);
  }
  return Array.from(groups.entries()).map(([key, incidents]) => {
    const latest = incidents[0];
    const typeKey =
      latest.triggerType ||
      (latest.title || latest.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    return {
      key,
      severity: latest.severity,
      label: humanizeEventType(typeKey, t),
      description: humanizeDescription(latest, t),
      count: incidents.length,
      firstSeen: Math.min(...incidents.map((i) => new Date(i.created_at).getTime())),
      lastSeen: Math.max(...incidents.map((i) => new Date(i.created_at).getTime())),
      latestIncident: latest,
      status: latest.status,
    };
  });
}

export function OperationsTab({ projectId, projectStatus }: OperationsTabProps) {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fromOpsCenter = searchParams.get('from') === 'ops-center';
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState | null>(null);
  const [config, setConfig] = useState<OpsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [incidentsData, cbData, configData] = await Promise.all([
        fetchOpsIncidents(projectId),
        fetchCircuitBreakerState(projectId).catch(() => ({ state: 'closed' })),
        fetchOpsConfig().catch(() => ({ config: null })),
      ]);
      setIncidents(
        (incidentsData.incidents || []).sort(
          (a: OpsIncident, b: OpsIncident) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
      setCircuitBreaker(cbData);
      if (configData.config) setConfig(configData.config);
      setError(null);
    } catch {
      setError('Failed to load operations data');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleResetCircuitBreaker = async () => {
    try {
      setResetting(true);
      await resetCircuitBreaker(projectId);
      await fetchData();
    } catch (err) {
      console.error('Failed to reset circuit breaker', err);
    } finally {
      setResetting(false);
    }
  };

  const handleToggleAutoRecovery = async (enabled: boolean) => {
    if (!config) return;
    try {
      const newConfig = { ...config, enabled };
      setConfig(newConfig);
      await updateOpsConfig({ enabled });
    } catch (err) {
      console.error('Failed to update config', err);
      setConfig(config); // revert
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 bg-bg-app">
        <AlertTriangle className="h-8 w-8 mb-3 text-error" />
        <p className="text-sm font-medium text-primary-ol">{t(error)}</p>
        <Button variant="outline" className="mt-4" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('Retry')}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full p-6 bg-bg-app space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const activeIncidents = incidents.filter((i) => i.status !== 'resolved');
  const pastIncidents = incidents.filter((i) => i.status === 'resolved');

  const activeGroups = groupIncidents(activeIncidents, t);
  const anyEscalated = activeIncidents.some((i) => i.status === 'escalated');
  const cbState = circuitBreaker?.state || 'closed';
  const cbFailures = circuitBreaker?.failure_count || 0;

  const hasDeployFailureWithoutIncident = projectStatus === 'error' && activeIncidents.length === 0;

  let status: StatusType = 'healthy';
  if (cbState === 'open') status = 'blocked';
  else if (activeIncidents.length > 0 && anyEscalated) status = 'broken';
  else if (activeIncidents.length > 0) status = 'degraded';
  else if (hasDeployFailureWithoutIncident) status = 'attention';

  const noiseSuppressed = activeIncidents.length - activeGroups.length;
  const lastEventTime =
    activeIncidents.length > 0
      ? Math.max(...activeIncidents.map((i) => new Date(i.created_at).getTime()))
      : null;

  return (
    <div className="flex flex-col h-full p-6 bg-bg-app overflow-auto space-y-6">
      {fromOpsCenter && (
        <button
          onClick={() => navigate('/operations')}
          className="flex items-center gap-1.5 text-sm text-muted-ol hover:text-primary-ol transition-colors mb-4 font-body"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t('operations.backToCenter') ?? 'Back to Operations Center'}</span>
        </button>
      )}

      {/* SECTION 1: Status Hero */}
      <StatusHeroCard
        status={status}
        cbState={cbState}
        cbFailures={cbFailures}
        activeIssuesCount={activeGroups.length}
        lastEventTime={lastEventTime}
        autoRecoveryEnabled={config?.enabled ?? true}
        configLoaded={!!config}
        resetting={resetting}
        onResetCircuitBreaker={handleResetCircuitBreaker}
        onToggleAutoRecovery={handleToggleAutoRecovery}
      />

      {/* SECTION 2: Triage Strip */}
      <Card className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x border-border bg-bg-panel/40 shadow-sm overflow-hidden rounded-xl">
        <div className="p-4 flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">{t('ops.openIssues')}</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-primary-ol">{activeGroups.length}</span>
            {activeGroups.length > 0 && (
              <div className="flex gap-1">
                {activeGroups.filter((g) => g.severity === 'critical').length > 0 && (
                  <SeverityBadge
                    severity="critical"
                    count={activeGroups.filter((g) => g.severity === 'critical').length}
                  />
                )}
                {activeGroups.filter((g) => g.severity === 'warning').length > 0 && (
                  <SeverityBadge
                    severity="warning"
                    count={activeGroups.filter((g) => g.severity === 'warning').length}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {noiseSuppressed > 0 ? (
          <div className="p-4 flex flex-col justify-center">
            <span className="text-xs font-medium text-muted-ol mb-1">
              {t('ops.noiseSuppressed')}
            </span>
            <span className="text-sm font-medium text-secondary-ol">
              <strong className="text-primary-ol">{noiseSuppressed}</strong>{' '}
              {t('ops.repeatedIncidentsGrouped')}
            </span>
          </div>
        ) : (
          <div className="p-4 flex flex-col justify-center opacity-60">
            <span className="text-xs font-medium text-muted-ol mb-1">
              {t('ops.noiseSuppressed')}
            </span>
            <span className="text-sm font-medium text-secondary-ol">
              {t('ops.zeroRepeatedIncidents')}
            </span>
          </div>
        )}

        <div className="p-4 flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">
            {t('ops.recoveryStatusLabel')}
          </span>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                status === 'blocked'
                  ? 'bg-error'
                  : status === 'attention'
                    ? 'bg-warning'
                    : status === 'degraded' || status === 'broken'
                      ? 'bg-warning animate-pulse'
                      : !(config?.enabled ?? true)
                        ? 'bg-muted-ol'
                        : 'bg-success',
              )}
            />
            <span className="text-sm font-medium text-primary-ol">
              {status === 'blocked'
                ? t('ops.blocked')
                : status === 'attention'
                  ? t('ops.waitingForRedeploy')
                  : status === 'degraded' || status === 'broken'
                    ? t('ops.retrying')
                    : !(config?.enabled ?? true)
                      ? t('ops.disabled')
                      : t('ops.idle')}
            </span>
          </div>
        </div>

        <div className="p-4 flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">{t('ops.lastAlert')}</span>
          <div className="flex items-center gap-2 text-muted-ol">
            <BellOff className="h-4 w-4" />
            <span className="text-sm font-medium">{t('ops.noAlertsConfigured')}</span>
          </div>
        </div>
      </Card>

      {/* SECTION 3: Active Issue Groups */}
      <div className="flex-1 space-y-4">
        <h3 className="text-sm font-semibold text-primary-ol flex items-center gap-2">
          {t('operations.activeIncidents')}
          <span className="bg-bg-subtle text-muted-ol px-2 rounded-full text-xs font-mono">
            {activeGroups.length}
          </span>
        </h3>

        {activeGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary-ol bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm">
            {status === 'attention' ? (
              <>
                <AlertTriangle className="h-8 w-8 mb-3 text-warning/70" />
                <p className="text-sm font-medium text-primary-ol">{t('ops.noRuntimeIncidents')}</p>
                <p className="text-xs text-muted-ol mt-1">{t('ops.deploymentFailedEarlier')}</p>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-8 w-8 mb-3 text-success/50" />
                <p className="text-sm font-medium text-primary-ol">{t('ops.allClear')}</p>
                <p className="text-xs text-muted-ol mt-1">{t('ops.noActiveIssuesDetected')}</p>
              </>
            )}
          </div>
        ) : (
          <Card className="divide-y divide-border/60 border-border bg-bg-panel shadow-sm rounded-xl overflow-hidden">
            {activeGroups.map((group) => (
              <IncidentCard
                key={group.key}
                group={group}
                projectName={t('Project')}
                incidentProjectId={group.latestIncident.project_id ?? projectId}
              />
            ))}
          </Card>
        )}
      </div>

      {/* SECTION 5: Past Incidents */}
      {pastIncidents.length > 0 && (
        <div className="pt-4">
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-primary-ol hover:text-agent transition-colors">
              <ChevronDown className="h-4 w-4" />
              {t('operations.incidentHistory')} ({pastIncidents.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-2">
              {pastIncidents.slice(0, 20).map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center justify-between p-3 bg-bg-panel border border-[hsl(var(--border))] rounded-lg shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <SeverityBadge severity={incident.severity} />
                    <span className="text-sm font-medium text-secondary-ol">
                      {incident.title || `Incident ${incident.id.slice(0, 16)}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-ol">
                    <span className="capitalize">{t(incident.status)}</span>
                    <span>{new Date(incident.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {pastIncidents.length > 20 && (
                <div className="text-center pt-2">
                  <span className="text-xs text-agent hover:underline cursor-pointer">
                    {t('Show more')}
                  </span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
