import type { OpsIncidentEvent } from '../../lib/api/operations.js';
import { useLanguage } from '../../i18n/context.js';

const TIMELINE_LABELS: Record<string, string> = {
  detected: 'Problem detected',
  diagnosed: 'Diagnosis attempted',
  action_taken: 'Recovery action taken',
  recovered: 'Service recovered',
  escalated: 'Manual intervention required',
  alert_sent: 'Alert sent',
  interrupted: 'Interrupted by restart',
};

interface IncidentTimelineProps {
  events: OpsIncidentEvent[];
}

export function IncidentTimeline({ events }: IncidentTimelineProps) {
  const { t } = useLanguage();

  if (events.length === 0) {
    return <div className="text-xs text-muted-ol italic">{t('operations.noTimelineEvents')}</div>;
  }

  const groupedEvents: { event: OpsIncidentEvent; count: number }[] = [];
  for (const e of events) {
    const last = groupedEvents[groupedEvents.length - 1];
    const currentType = e.type || e.event_type;
    const lastType = last?.event.type || last?.event.event_type;
    if (last && lastType === currentType && last.event.message === e.message) {
      last.count++;
    } else {
      groupedEvents.push({ event: e, count: 1 });
    }
  }

  return (
    <div className="relative pl-4 border-l-2 border-border/50 space-y-6">
      {groupedEvents.map((g, idx) => (
        <div key={idx} className="relative">
          <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-agent border-2 border-bg-subtle" />
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-primary-ol">
                {t(
                  TIMELINE_LABELS[(g.event.type || g.event.event_type)!] ||
                    (g.event.type || g.event.event_type || 'unknown').replace(/_/g, ' '),
                )}
              </span>
              <span className="text-xs text-muted-ol">
                {new Date(g.event.created_at).toLocaleTimeString()}
              </span>
            </div>
            {g.event.message && (
              <span className="mt-1 break-words text-sm text-secondary-ol">{g.event.message}</span>
            )}
            {g.count > 1 && (
              <span className="text-xs text-muted-ol mt-2 italic">
                {t('This condition repeated {count} times without state change.', {
                  count: g.count,
                })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
