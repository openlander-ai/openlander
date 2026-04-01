import { useState, useEffect, useCallback } from 'react';
import {
  fetchOpsIncidents,
  fetchCircuitBreakerState,
  type OpsIncident,
  type CircuitBreakerState,
  type OpsIncidentEvent,
} from '@/lib/api/operations';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ShieldAlert, ChevronDown, Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OperationsTabProps {
  projectId: string;
}

export function OperationsTab({ projectId }: OperationsTabProps) {
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [incidentsData, cbData] = await Promise.all([
        fetchOpsIncidents(projectId),
        fetchCircuitBreakerState(projectId).catch(() => ({ state: 'closed' })),
      ]);
      setIncidents(
        (incidentsData.incidents || []).sort(
          (a: OpsIncident, b: OpsIncident) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
      setCircuitBreaker(cbData);
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

  if (loading) {
    return (
      <div className="flex flex-col h-full p-6 bg-bg-app">
        <div className="flex gap-4 mb-6">
          <Skeleton className="h-10 w-48 rounded-lg" />
          <Skeleton className="h-10 w-48 rounded-lg" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const activeIncidentCount = incidents.filter((i) => i.status !== 'resolved').length;
  const cbState = circuitBreaker?.state || 'closed';

  return (
    <div className="flex flex-col h-full p-6 bg-bg-app overflow-auto">
      <div className="flex gap-4 mb-6">
        <Card className="flex items-center gap-3 px-4 py-3 bg-bg-panel border-[hsl(var(--border))] shadow-sm">
          <Activity className="h-5 w-5 text-muted-ol" />
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-ol">Active Incidents</span>
            <span className="text-sm font-semibold text-primary-ol">{activeIncidentCount}</span>
          </div>
        </Card>
        <Card className="flex items-center gap-3 px-4 py-3 bg-bg-panel border-[hsl(var(--border))] shadow-sm">
          <ShieldAlert className="h-5 w-5 text-muted-ol" />
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-ol">Circuit Breaker</span>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge
                variant={
                  cbState === 'open'
                    ? 'destructive'
                    : cbState === 'half_open'
                      ? 'outline'
                      : 'secondary'
                }
                className="h-5 px-1.5 text-[10px]"
              >
                {cbState.toUpperCase()}
              </Badge>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex-1">
        <h3 className="text-sm font-semibold text-primary-ol mb-4">Incident History</h3>

        {error ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary-ol bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm">
            <AlertTriangle className="h-8 w-8 mb-3 text-muted-ol" />
            <p className="text-sm font-body">{error}</p>
          </div>
        ) : incidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary-ol bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm">
            <CheckCircle2 className="h-8 w-8 mb-3 text-muted-ol" />
            <p className="text-sm font-body">No incidents recorded</p>
          </div>
        ) : (
          <div className="space-y-3">
            {incidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IncidentCard({ incident }: { incident: OpsIncident }) {
  const [isOpen, setIsOpen] = useState(false);

  const severity = incident.severity || 'info';
  const status = incident.status || 'unknown';
  const title = incident.title || `Incident ${incident.id.substring(0, 8)}`;
  const date = incident.created_at
    ? new Date(incident.created_at).toLocaleString()
    : 'Unknown date';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="bg-bg-panel border-[hsl(var(--border))] shadow-sm overflow-hidden transition-colors hover:bg-bg-subtle/50">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Badge
                variant={
                  severity === 'critical'
                    ? 'destructive'
                    : severity === 'warning'
                      ? 'outline'
                      : 'secondary'
                }
                className="capitalize"
              >
                {severity}
              </Badge>
              <span className="font-medium text-sm text-primary-ol text-left">{title}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-medium text-muted-ol capitalize">
                {status.replace('_', ' ')}
              </span>
              <span className="text-xs text-muted-ol">{date}</span>
              <ChevronDown
                className={cn('h-4 w-4 text-muted-ol transition-transform', isOpen && 'rotate-180')}
              />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t border-[hsl(var(--border))] mt-2">
            <div className="mt-4 space-y-4">
              <h4 className="text-xs font-semibold text-muted-ol uppercase tracking-wider">
                Timeline
              </h4>
              <div className="relative pl-4 border-l-2 border-border/50 space-y-4">
                {incident.events && incident.events.length > 0 ? (
                  incident.events.map((event: OpsIncidentEvent, idx: number) => (
                    <div key={idx} className="relative">
                      <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-agent border-2 border-bg-panel" />
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-primary-ol capitalize">
                          {event.type.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-muted-ol mt-0.5">
                          {new Date(event.created_at).toLocaleString()}
                        </span>
                        {event.message && (
                          <span className="text-xs text-secondary-ol mt-1 bg-bg-subtle p-2 rounded-md border border-border/50">
                            {event.message}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-muted-ol italic">No timeline events available</div>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
