import { useState } from 'react';
import { Card } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible.js';
import { AlertTriangle, XCircle, ChevronDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils.js';
import {
  fetchIncidentEvents,
  type OpsIncident,
  type OpsIncidentEvent,
} from '../../lib/api/operations.js';
import { IncidentTimeline } from './IncidentTimeline.js';
import { relativeTime } from './utils.js';
import { useLanguage } from '../../i18n/context.js';

export interface IncidentGroup {
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

interface IncidentCardProps {
  group: IncidentGroup;
  projectName: string;
  incidentProjectId: string;
}

export function IncidentCard({ group, projectName, incidentProjectId }: IncidentCardProps) {
  const { t, language } = useLanguage();
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
        'min-w-0 overflow-hidden border-[hsl(var(--border))] shadow-sm transition-colors',
        isCritical
          ? 'border-l-4 border-l-error bg-error/5'
          : 'border-l-4 border-l-warning bg-warning/5',
      )}
    >
      <div className="p-4 lg:p-5">
        <div className="mb-4 flex min-w-0 items-center gap-2.5 border-b border-border/50 pb-3">
          <Badge
            variant="outline"
            className="shrink-0 bg-bg-panel px-2 py-[2px] font-body text-xs text-secondary-ol shadow-sm"
          >
            {projectName}
          </Badge>
          <span
            className="min-w-0 flex-1 truncate border-l border-border/60 pl-1 font-mono text-[11px] text-muted-ol opacity-80"
            title={incidentProjectId}
          >
            {incidentProjectId}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'h-6 shrink-0 whitespace-nowrap px-2.5 text-[11px] capitalize',
              isCritical
                ? 'text-error border-error/50 bg-error/10'
                : 'text-warning border-warning/50 bg-warning/10',
              group.status === 'resolved' && 'text-success border-success/50 bg-success/10',
            )}
          >
            {t(group.status.replace('_', ' '))}
          </Badge>
        </div>

        <div className="flex items-start gap-4 mb-5">
          <div
            className={cn(
              'flex items-center justify-center h-8 w-8 rounded-full shrink-0 shadow-sm mt-0.5',
              isCritical ? 'bg-error/20 text-error' : 'bg-warning/20 text-warning',
            )}
          >
            {isCritical ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </div>
          <div className="flex-1">
            <h4
              className={cn(
                'text-lg font-semibold font-display mb-1.5',
                isCritical ? 'text-error' : 'text-warning',
              )}
            >
              {t(group.label)}
            </h4>
            <p className="break-words whitespace-pre-wrap text-sm font-body leading-relaxed text-primary-ol">
              {t(group.description)}
            </p>
          </div>
        </div>

        <div className="mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/50 bg-bg-app px-3 py-2 text-[11px] font-mono text-muted-ol shadow-sm sm:ml-[48px] sm:w-fit sm:max-w-[calc(100%-3rem)]">
          <span className="font-medium text-secondary-ol">
            {t('ops.occurrences', { count: String(group.count) })}
          </span>
          <span className="hidden opacity-40 sm:inline">&middot;</span>
          <span>
            {t('ops.first')}:{' '}
            {new Date(group.firstSeen).toLocaleDateString(language === 'ko' ? 'ko-KR' : undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="hidden opacity-40 sm:inline">&middot;</span>
          <span>
            {t('ops.last')}:{' '}
            <span className="text-secondary-ol">{relativeTime(group.lastSeen, language)}</span>
          </span>
        </div>

        <div className="mt-4 sm:ml-[48px]">
          <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="w-full min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 bg-bg-panel text-xs text-secondary-ol hover:bg-bg-subtle"
                >
                  {t('ops.viewTimeline')}
                  <ChevronDown
                    className={cn('ml-2 h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
                  />
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-ol hover:text-secondary-ol"
                onClick={() =>
                  toast.info(
                    t('ops.featureNotReady') || 'This feature is currently under development.',
                  )
                }
              >
                {t('ops.acknowledge')}
              </Button>
            </div>

            <CollapsibleContent className="mt-4 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
              <div className="rounded-lg border border-border bg-bg-panel/80 p-5 shadow-sm">
                <h5 className="mb-5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-ol">
                  <RefreshCw className="h-3 w-3" />
                  {t('ops.latestTimeline')}
                </h5>

                {loadingEvents ? (
                  <div className="flex items-center justify-center py-6">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-ol" />
                  </div>
                ) : (
                  <IncidentTimeline events={events} />
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </Card>
  );
}
