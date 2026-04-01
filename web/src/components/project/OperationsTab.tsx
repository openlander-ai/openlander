import { useState, useEffect, useCallback } from 'react';
import {
  fetchOpsIncidents,
  fetchCircuitBreakerState,
  resetCircuitBreaker,
  fetchIncidentEvents,
  fetchOpsConfig,
  updateOpsConfig,
  type OpsIncident,
  type CircuitBreakerState,
  type OpsIncidentEvent,
  type OpsConfig,
} from '@/lib/api/operations';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  ShieldAlert,
  ChevronDown,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldOff,
  Clock,
  BellOff,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OperationsTabProps {
  projectId: string;
}

const EVENT_LABELS: Record<string, string> = {
  'container:missing': 'Container Missing',
  'container:crashed': 'Container Crashed',
  'deploy:crash': 'Container Crashed',
  'deploy:failed': 'Deploy Failed',
  'health:degraded': 'Health Degraded',
  'recovery:failed': 'Recovery Failed',
  'recovery:exhausted': 'Recovery Exhausted',
  'monitor:inactive': 'Service Inactive',
};

const TIMELINE_LABELS: Record<string, string> = {
  detected: 'Problem detected',
  diagnosed: 'Diagnosis attempted',
  action_taken: 'Recovery action taken',
  recovered: 'Service recovered',
  escalated: 'Manual intervention required',
  alert_sent: 'Alert sent',
  interrupted: 'Interrupted by restart',
};

function extractEventType(inc: OpsIncident): string {
  if (inc.events && inc.events.length > 0) {
    return inc.events[0].type;
  }
  return inc.title.toLowerCase().replace(/\s+/g, '_');
}

function humanizeEventType(type: string): string {
  return EVENT_LABELS[type] || type.replace(':', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function humanizeDescription(inc: OpsIncident): string {
  if (inc.events && inc.events.length > 0) {
    return inc.events[0].message || inc.title;
  }
  return inc.title;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface IncidentGroup {
  key: string;
  severity: string;
  label: string;
  description: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  latestIncident: OpsIncident;
  status: string;
}

function groupIncidents(incidents: OpsIncident[]): IncidentGroup[] {
  const groups = new Map<string, OpsIncident[]>();
  for (const inc of incidents) {
    const key = `${inc.severity}::${extractEventType(inc)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inc);
  }
  return Array.from(groups.entries()).map(([key, incidents]) => ({
    key,
    severity: incidents[0].severity,
    label: humanizeEventType(extractEventType(incidents[0])),
    description: humanizeDescription(incidents[0]),
    count: incidents.length,
    firstSeen: Math.min(...incidents.map((i) => new Date(i.created_at).getTime())),
    lastSeen: Math.max(...incidents.map((i) => new Date(i.created_at).getTime())),
    latestIncident: incidents[0],
    status: incidents[0].status,
  }));
}

export function OperationsTab({ projectId }: OperationsTabProps) {
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
        <p className="text-sm font-medium text-primary-ol">{error}</p>
        <Button variant="outline" className="mt-4" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
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

  const activeGroups = groupIncidents(activeIncidents);
  const anyEscalated = activeIncidents.some((i) => i.status === 'escalated');
  const cbState = circuitBreaker?.state || 'closed';
  const cbFailures = circuitBreaker?.failure_count || 0;

  let status: 'healthy' | 'degraded' | 'broken' | 'blocked' = 'healthy';
  if (cbState === 'open') status = 'blocked';
  else if (activeIncidents.length > 0 && anyEscalated) status = 'broken';
  else if (activeIncidents.length > 0) status = 'degraded';

  const statusConfig = {
    healthy: {
      color: 'text-success',
      bg: 'bg-success/5',
      border: 'border-success/20',
      icon: CheckCircle2,
      title: 'Healthy',
      desc: 'No active incidents. Auto-recovery enabled.',
    },
    degraded: {
      color: 'text-warning',
      bg: 'bg-warning/5',
      border: 'border-warning/20',
      icon: AlertTriangle,
      title: 'Degraded',
      desc: 'Recovery in progress — service unstable.',
    },
    broken: {
      color: 'text-error',
      bg: 'bg-error/5',
      border: 'border-error/20',
      icon: XCircle,
      title: 'Broken',
      desc: 'Service unavailable. Recovery attempts remaining.',
    },
    blocked: {
      color: 'text-error',
      bg: 'bg-error/10',
      border: 'border-error/30',
      icon: ShieldOff,
      title: 'Recovery Blocked',
      desc: 'Auto-recovery paused after repeated failures. Manual action required.',
    },
  };

  const currentStatus = statusConfig[status];
  const StatusIcon = currentStatus.icon;

  const noiseSuppressed = activeIncidents.length - activeGroups.length;
  const lastEventTime =
    activeIncidents.length > 0
      ? Math.max(...activeIncidents.map((i) => new Date(i.created_at).getTime()))
      : null;

  return (
    <div className="flex flex-col h-full p-6 bg-bg-app overflow-auto space-y-6">
      {/* SECTION 1: Status Hero */}
      <Card
        className={cn(
          'flex flex-col md:flex-row items-start md:items-center justify-between p-6 border shadow-sm',
          currentStatus.bg,
          currentStatus.border,
        )}
      >
        <div className="flex items-start gap-4 mb-4 md:mb-0">
          <StatusIcon className={cn('h-8 w-8 mt-1', currentStatus.color)} />
          <div className="flex flex-col">
            <h2 className={cn('text-xl font-bold', currentStatus.color)}>{currentStatus.title}</h2>
            <p className="text-sm text-secondary-ol mt-1">{currentStatus.desc}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-ol font-medium">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                CB: {cbState.toUpperCase()} {cbState !== 'closed' && `${cbFailures}/5`}
              </span>
              <span className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {activeGroups.length} Issue{activeGroups.length !== 1 ? 's' : ''}
              </span>
              {lastEventTime && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {relativeTime(lastEventTime)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
          {status === 'blocked' && (
            <Button
              variant="destructive"
              onClick={handleResetCircuitBreaker}
              disabled={resetting}
              className="w-full sm:w-auto"
            >
              {resetting ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShieldOff className="h-4 w-4 mr-2" />
              )}
              Reset Circuit Breaker
            </Button>
          )}
          {(status === 'broken' || status === 'blocked') && status !== 'blocked' && (
            <Button variant="outline" className="w-full sm:w-auto">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Recovery
            </Button>
          )}
          <div className="flex items-center gap-3 bg-bg-panel px-4 py-2 rounded-lg border border-[hsl(var(--border))] w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-sm font-medium text-primary-ol">Auto-recovery</span>
            <Switch
              checked={config?.enabled ?? true}
              onCheckedChange={handleToggleAutoRecovery}
              disabled={!config}
            />
          </div>
        </div>
      </Card>

      {/* SECTION 2: Triage Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-bg-panel border-[hsl(var(--border))] shadow-sm flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">Open Issues</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-primary-ol">{activeGroups.length}</span>
            {activeGroups.length > 0 && (
              <div className="flex gap-1">
                {activeGroups.filter((g) => g.severity === 'critical').length > 0 && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                    {activeGroups.filter((g) => g.severity === 'critical').length} CRIT
                  </Badge>
                )}
                {activeGroups.filter((g) => g.severity === 'warning').length > 0 && (
                  <Badge
                    variant="outline"
                    className="h-5 px-1.5 text-[10px] text-warning border-warning/50"
                  >
                    {activeGroups.filter((g) => g.severity === 'warning').length} WARN
                  </Badge>
                )}
              </div>
            )}
          </div>
        </Card>

        {noiseSuppressed > 0 ? (
          <Card className="p-4 bg-bg-panel border-[hsl(var(--border))] shadow-sm flex flex-col justify-center">
            <span className="text-xs font-medium text-muted-ol mb-1">Noise Suppressed</span>
            <span className="text-sm font-medium text-secondary-ol">
              <strong className="text-primary-ol">{noiseSuppressed}</strong> repeated incidents
              grouped
            </span>
          </Card>
        ) : (
          <Card className="p-4 bg-bg-panel border-[hsl(var(--border))] shadow-sm flex flex-col justify-center opacity-50">
            <span className="text-xs font-medium text-muted-ol mb-1">Noise Suppressed</span>
            <span className="text-sm font-medium text-secondary-ol">0 repeated incidents</span>
          </Card>
        )}

        <Card className="p-4 bg-bg-panel border-[hsl(var(--border))] shadow-sm flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">Recovery Status</span>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                status === 'blocked'
                  ? 'bg-error'
                  : status === 'degraded' || status === 'broken'
                    ? 'bg-warning animate-pulse'
                    : !(config?.enabled ?? true)
                      ? 'bg-muted-ol'
                      : 'bg-success',
              )}
            />
            <span className="text-sm font-medium text-primary-ol">
              {status === 'blocked'
                ? 'Blocked'
                : status === 'degraded' || status === 'broken'
                  ? 'Retrying'
                  : !(config?.enabled ?? true)
                    ? 'Disabled'
                    : 'Idle'}
            </span>
          </div>
        </Card>

        <Card className="p-4 bg-bg-panel border-[hsl(var(--border))] shadow-sm flex flex-col justify-center">
          <span className="text-xs font-medium text-muted-ol mb-1">Last Alert</span>
          <div className="flex items-center gap-2">
            <BellOff className="h-4 w-4 text-muted-ol" />
            <span className="text-sm font-medium text-muted-ol">No alerts configured</span>
          </div>
        </Card>
      </div>

      {/* SECTION 3: Active Issue Groups */}
      <div className="flex-1 space-y-4">
        <h3 className="text-sm font-semibold text-primary-ol">Active Issues</h3>

        {activeGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary-ol bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm">
            <CheckCircle2 className="h-8 w-8 mb-3 text-success/50" />
            <p className="text-sm font-medium text-primary-ol">All clear</p>
            <p className="text-xs text-muted-ol mt-1">No active issues detected.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeGroups.map((group) => (
              <IncidentGroupCard key={group.key} group={group} />
            ))}
          </div>
        )}
      </div>

      {/* SECTION 5: Past Incidents */}
      {pastIncidents.length > 0 && (
        <div className="pt-4">
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-primary-ol hover:text-agent transition-colors">
              <ChevronDown className="h-4 w-4" />
              Past Incidents ({pastIncidents.length})
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-2">
              {pastIncidents.slice(0, 20).map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center justify-between p-3 bg-bg-panel border border-[hsl(var(--border))] rounded-lg shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 capitalize">
                      {incident.severity}
                    </Badge>
                    <span className="text-sm font-medium text-secondary-ol">{incident.title}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-ol">
                    <span className="capitalize">{incident.status}</span>
                    <span>{new Date(incident.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {pastIncidents.length > 20 && (
                <div className="text-center pt-2">
                  <span className="text-xs text-agent hover:underline cursor-pointer">
                    Show more
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

function IncidentGroupCard({ group }: { group: IncidentGroup }) {
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState<OpsIncidentEvent[]>(group.latestIncident.events || []);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const handleOpenChange = async (open: boolean) => {
    setIsOpen(open);
    if (open && (!events || events.length === 0)) {
      setLoadingEvents(true);
      try {
        const data = await fetchIncidentEvents(group.latestIncident.id);
        setEvents(data.events || []);
      } catch (err) {
        console.error('Failed to fetch events', err);
      } finally {
        setLoadingEvents(false);
      }
    }
  };

  const isCritical = group.severity === 'critical';

  return (
    <Card
      className={cn(
        'bg-bg-panel border-[hsl(var(--border))] shadow-sm overflow-hidden transition-colors',
        isCritical ? 'border-l-4 border-l-error' : 'border-l-4 border-l-warning',
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex items-center justify-center h-6 w-6 rounded-full',
                isCritical ? 'bg-error/10 text-error' : 'bg-warning/10 text-warning',
              )}
            >
              {isCritical ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <h4 className="text-base font-semibold text-primary-ol">{group.label}</h4>
          </div>
          <Badge variant="outline" className="capitalize text-xs font-medium">
            {group.status.replace('_', ' ')}
          </Badge>
        </div>

        <p className="text-sm text-secondary-ol ml-9 mb-4">{group.description}</p>

        <div className="flex items-center gap-4 ml-9 text-xs text-muted-ol font-medium">
          <span>
            {group.count} occurrence{group.count !== 1 ? 's' : ''}
          </span>
          <span>&middot;</span>
          <span>
            First:{' '}
            {new Date(group.firstSeen).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <span>&middot;</span>
          <span>Last: {relativeTime(group.lastSeen)}</span>
        </div>

        <div className="flex items-center gap-3 ml-9 mt-4">
          <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                View Timeline
                <ChevronDown
                  className={cn('ml-2 h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" className="h-8 text-xs ml-2">
              Acknowledge
            </Button>

            <CollapsibleContent className="mt-4">
              <div className="bg-bg-subtle rounded-lg p-4 border border-[hsl(var(--border))]">
                <h5 className="text-xs font-semibold text-muted-ol uppercase tracking-wider mb-4">
                  Latest Incident Timeline
                </h5>

                {loadingEvents ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="h-4 w-4 text-muted-ol animate-spin" />
                  </div>
                ) : events.length === 0 ? (
                  <div className="text-xs text-muted-ol italic">No timeline events available</div>
                ) : (
                  <div className="relative pl-4 border-l-2 border-border/50 space-y-6">
                    {(() => {
                      const groupedEvents: { event: OpsIncidentEvent; count: number }[] = [];
                      for (const e of events) {
                        const last = groupedEvents[groupedEvents.length - 1];
                        if (
                          last &&
                          last.event.type === e.type &&
                          last.event.message === e.message
                        ) {
                          last.count++;
                        } else {
                          groupedEvents.push({ event: e, count: 1 });
                        }
                      }

                      return groupedEvents.map((g, idx) => (
                        <div key={idx} className="relative">
                          <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-agent border-2 border-bg-subtle" />
                          <div className="flex flex-col">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium text-primary-ol">
                                {TIMELINE_LABELS[g.event.type] || g.event.type.replace('_', ' ')}
                              </span>
                              <span className="text-xs text-muted-ol">
                                {new Date(g.event.created_at).toLocaleTimeString()}
                              </span>
                            </div>
                            {g.event.message && (
                              <span className="text-sm text-secondary-ol mt-1">
                                {g.event.message}
                              </span>
                            )}
                            {g.count > 1 && (
                              <span className="text-xs text-muted-ol mt-2 italic">
                                This condition repeated {g.count} times without state change.
                              </span>
                            )}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </Card>
  );
}
