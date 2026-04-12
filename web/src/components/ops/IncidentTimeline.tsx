import type { OpsIncidentEvent } from '../../lib/api/operations.js';
import { useLanguage } from '../../i18n/context.js';
import { parseTimestamp } from '../../lib/time.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

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
    <div className="relative pl-5 border-l-2 border-border space-y-6">
      {groupedEvents.map((g, idx) => (
        <div key={idx} className="relative">
          <div className="absolute -left-[25px] top-1 h-3 w-3 rounded-full bg-agent border-2 border-bg-panel shadow-sm" />
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-primary-ol">
                {(TIMELINE_EVENT_TYPES as readonly string[]).includes(g.event.type)
                  ? t(`operations.timelineEvents.${g.event.type}`)
                  : g.event.type.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-muted-ol">
                {parseTimestamp(String(g.event.created_at))?.toLocaleTimeString()}
              </span>
            </div>
            {g.event.message && (
              <div className="prose prose-sm max-w-none prose-p:my-1 prose-p:leading-relaxed prose-p:text-secondary-ol prose-strong:text-secondary-ol prose-strong:font-semibold prose-a:text-ai prose-code:text-ai/80 prose-code:bg-bg-subtle prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-ul:my-1 prose-li:my-0 mt-1 break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                  {g.event.message}
                </ReactMarkdown>
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
