import type { OpsIncidentEvent } from '../../lib/api/operations.js';
import { useLanguage } from '../../i18n/context.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const TIMELINE_EVENT_TYPES = [
  'detected',
  'diagnosed',
  'action_taken',
  'recovered',
  'escalated',
  'alert_sent',
  'interrupted',
  'cascade_detected',
] as const;

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
    if (last && last.event.type === e.type && last.event.message === e.message) {
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
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-primary-ol">
                {(TIMELINE_EVENT_TYPES as readonly string[]).includes(g.event.type)
                  ? t(`operations.timelineEvents.${g.event.type}`)
                  : g.event.type.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-muted-ol">
                {new Date(g.event.created_at).toLocaleTimeString()}
              </span>
            </div>
            {g.event.message && (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-p:text-secondary-ol prose-strong:text-secondary-ol prose-strong:font-semibold prose-a:text-ai prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0 mt-1 break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{g.event.message}</ReactMarkdown>
              </div>
            )}
            {g.count > 1 && (
              <span className="text-xs text-muted-ol mt-2 italic">
                {t('operations.timelineEvents.repeatedCondition', {
                  count: String(g.count),
                })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
