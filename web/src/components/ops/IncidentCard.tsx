import { useState } from 'react';
import { Card } from '../ui/card.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible.js';
import { AlertTriangle, XCircle, ChevronDown, RefreshCw } from 'lucide-react';
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
}

export function IncidentCard({ group }: IncidentCardProps) {
  const { t } = useLanguage();
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
            <h4 className="text-base font-semibold text-primary-ol">{t(group.label)}</h4>
          </div>
          <Badge variant="outline" className="capitalize text-xs font-medium">
            {t(group.status.replace('_', ' '))}
          </Badge>
        </div>

        <p className="text-sm text-secondary-ol ml-9 mb-4">{t(group.description)}</p>

        <div className="flex items-center gap-4 ml-9 text-xs text-muted-ol font-medium">
          <span>
            {group.count} {t('occurrence')}
            {group.count !== 1 ? 's' : ''}
          </span>
          <span>&middot;</span>
          <span>
            {t('First')}:{' '}
            {new Date(group.firstSeen).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
          <span>&middot;</span>
          <span>
            {t('Last')}: {relativeTime(group.lastSeen)}
          </span>
        </div>

        <div className="flex items-center gap-3 ml-9 mt-4">
          <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                {t('View Timeline')}
                <ChevronDown
                  className={cn('ml-2 h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" className="h-8 text-xs ml-2">
              {t('Acknowledge')}
            </Button>

            <CollapsibleContent className="mt-4">
              <div className="bg-bg-subtle rounded-lg p-4 border border-[hsl(var(--border))]">
                <h5 className="text-xs font-semibold text-muted-ol uppercase tracking-wider mb-4">
                  {t('Latest Incident Timeline')}
                </h5>

                {loadingEvents ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="h-4 w-4 text-muted-ol animate-spin" />
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
