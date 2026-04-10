import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SeverityBadge } from '@/components/ops/SeverityBadge';
import { IncidentTimeline } from '@/components/ops/IncidentTimeline';
import { fetchOpsIncident } from '@/lib/api/operations';
import type { OpsIncident, OpsIncidentEvent } from '@/lib/api/operations';
import { Loader2, AlertCircle, Clock } from 'lucide-react';
import { humanizeEventType } from '@/components/ops/utils';
import { cn } from '@/lib/utils';

interface IncidentDetailSlideoverProps {
  incidentId: string | null;
  onClose: () => void;
}

export function IncidentDetailSlideover({ incidentId, onClose }: IncidentDetailSlideoverProps) {
  const { t } = useLanguage();
  const [incident, setIncident] = useState<OpsIncident | null>(null);
  const [events, setEvents] = useState<OpsIncidentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) {
      setIncident(null);
      setEvents([]);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchOpsIncident(incidentId)
      .then((data) => {
        if (isMounted) {
          setIncident(data.incident);
          setEvents(data.events);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : t('opsV2.incident.loadError'));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [incidentId, t]);

  const isOpen = incidentId !== null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md md:max-w-lg p-0 flex flex-col bg-app border-l border-[hsl(var(--border))]"
      >
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-ol" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <AlertCircle className="h-8 w-8 text-error mb-4" />
            <p className="text-sm text-error">{error}</p>
          </div>
        ) : incident ? (
          <>
            <div className="shrink-0 border-b border-[hsl(var(--border))] p-6 bg-bg-panel">
              <SheetHeader className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <SheetTitle className="text-lg font-display font-semibold text-primary-ol">
                      {incident.title}
                    </SheetTitle>
                    <SheetDescription className="text-sm text-secondary-ol">
                      {incident.projectName || incident.project_id}
                    </SheetDescription>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <span
                    className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full border',
                      incident.status === 'active'
                        ? 'bg-warning/10 text-warning border-warning/20'
                        : incident.status === 'resolved'
                          ? 'bg-success/10 text-success border-success/20'
                          : 'bg-bg-subtle text-secondary-ol border-[hsl(var(--border))]',
                    )}
                  >
                    {t(`opsV2.status.${incident.status}`)}
                  </span>
                  {incident.status === 'active' && (
                    <span className="text-xs text-agent animate-pulse flex items-center gap-1.5 ml-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('opsV2.incident.recovering')}
                    </span>
                  )}
                </div>
              </SheetHeader>
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-8">
                {/* Trigger Info */}
                {incident.triggerType && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.trigger')}
                    </h3>
                    <div className="bg-bg-subtle/50 rounded-md p-3 border border-[hsl(var(--border))]">
                      <p className="text-sm text-secondary-ol font-medium">
                        {humanizeEventType(incident.triggerType ?? 'unknown', t)}
                      </p>
                      {incident.triggerDetails && (
                        <p className="text-xs text-muted-ol mt-1 font-mono break-all">
                          {incident.triggerDetails}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Diagnosis & Root Cause */}
                {(incident.diagnosis || incident.root_cause) && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.diagnosis')}
                    </h3>
                    <div className="bg-agent/5 border border-agent/20 rounded-md p-4 space-y-4">
                      {incident.root_cause && (
                        <div>
                          <h4 className="text-xs font-semibold text-agent mb-1 uppercase tracking-wider">
                            {t('opsV2.incident.rootCause')}
                          </h4>
                          <p className="text-sm text-primary-ol leading-relaxed">
                            {incident.root_cause}
                          </p>
                        </div>
                      )}
                      {incident.diagnosis && (
                        <div>
                          <h4 className="text-xs font-semibold text-agent mb-1 uppercase tracking-wider">
                            {t('opsV2.incident.diagnosis')}
                          </h4>
                          <p className="text-sm text-primary-ol leading-relaxed">
                            {incident.diagnosis}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions Taken */}
                {incident.actions_taken && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-primary-ol">
                      {t('opsV2.incident.actionsTaken')}
                    </h3>
                    <div className="bg-bg-subtle/50 rounded-md p-4 border border-[hsl(var(--border))]">
                      <p className="text-sm text-secondary-ol leading-relaxed whitespace-pre-wrap">
                        {incident.actions_taken}
                      </p>
                    </div>
                  </div>
                )}

                {/* Timeline */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-primary-ol">
                    {t('opsV2.incident.timeline')}
                  </h3>
                  {events.length > 0 ? (
                    <IncidentTimeline events={events} />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center border rounded border-dashed border-[hsl(var(--border))]">
                      <Clock className="mb-2 h-6 w-6 text-muted-ol/50" />
                      <p className="text-sm font-medium text-primary-ol">
                        {t('opsV2.incident.noEventsTitle')}
                      </p>
                      <p className="text-xs text-muted-ol mt-1">
                        {t('opsV2.incident.noEventsDesc')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
