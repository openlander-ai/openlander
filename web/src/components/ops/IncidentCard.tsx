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
        'border-[hsl(var(--border))] shadow-sm overflow-hidden transition-colors',
        isCritical
          ? 'border-l-4 border-l-error bg-error/5'
          : 'border-l-4 border-l-warning bg-warning/5',
      )}
    >
      <div className="p-4 lg:p-5">
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border/50">
          <Badge
            variant="outline"
            className="font-body text-xs text-secondary-ol px-2 py-[2px] bg-bg-panel shadow-sm"
          >
            {projectName}
          </Badge>
          <span className="font-mono text-[11px] text-muted-ol opacity-80 pl-1 border-l border-border/60">
            {incidentProjectId}
          </span>
          <div className="flex-1" />
          <Badge
            variant="outline"
            className={cn(
              'capitalize text-[11px] h-6 px-2.5 whitespace-nowrap',
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
            <p className="text-sm font-body text-primary-ol leading-relaxed whitespace-pre-wrap">
              {t(group.description)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-[48px] text-[11px] font-mono text-muted-ol bg-bg-app rounded-md px-3 py-2 w-fit border border-border/50 shadow-sm">
          <span className="text-secondary-ol font-medium">
            {t('ops.occurrences', { count: String(group.count) })}
          </span>
          <span className="opacity-40">&middot;</span>
          <span>
            {t('ops.first')}:{' '}
            {new Date(group.firstSeen).toLocaleDateString(language === 'ko' ? 'ko-KR' : undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span className="opacity-40">&middot;</span>
          <span>
            {t('ops.last')}:{' '}
            <span className="text-secondary-ol">{relativeTime(group.lastSeen, language)}</span>
          </span>
        </div>

        <div className="flex items-center gap-3 ml-[48px] mt-4">
          <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs bg-bg-panel hover:bg-bg-subtle text-secondary-ol"
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
              className="h-8 text-xs ml-2 text-muted-ol hover:text-secondary-ol"
              onClick={() =>
                toast.info(
                  t('ops.featureNotReady') || 'This feature is currently under development.',
                )
              }
            >
              {t('ops.acknowledge')}
            </Button>

            <CollapsibleContent className="mt-4 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
              <div className="bg-bg-panel/80 rounded-lg p-5 border border-border shadow-sm">
                <h5 className="text-[11px] font-bold text-muted-ol uppercase tracking-wider mb-5 flex items-center gap-2">
                  <RefreshCw className="h-3 w-3" />
                  {t('ops.latestTimeline')}
                </h5>

                {loadingEvents ? (
                  <div className="flex items-center justify-center py-6">
                    <RefreshCw className="h-5 w-5 text-muted-ol animate-spin" />
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
