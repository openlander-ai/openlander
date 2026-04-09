import { useState } from 'react';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function formatIncidentTitle(text: string): string {
  if (!text) return '';
  // If text contains underscores, we treat it as a raw machine identifier and format it
  if (text.includes('_')) {
    let formatted = text.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    // Ensure proper spacing around parentheses
    formatted = formatted.replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\(/g, ' (');
    // Capitalize first letter, lowercase the rest
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1).toLowerCase();
    // Clean up multiple spaces
    return formatted.replace(/\s+/g, ' ').trim();
  }
  return text;
}

function formatIncidentDescription(text: string): string {
  if (!text) return '';
  let formatted = text;

  // 1. Force paragraph breaks before sections like [근본 원인] or **Root Cause**
  formatted = formatted.replace(/(?<!\n\n)(^|\n)(\[[^\]]+\]|\*\*[^*]+\*\*)/g, '\n\n$1$2');

  // 2. Force paragraph breaks before lists so they render properly instead of merging with text
  formatted = formatted.replace(/(?<!\n\n)(^|\n)(\s*[-*]|\s*\d+\.)/g, '\n\n$1$2');

  // 3. Add double spaces to all single newlines to trigger markdown <br /> rendering.
  // This preserves AI line breaks inside a single paragraph block.
  formatted = formatted.replace(/([^\s])(\n)/g, '$1  $2');

  return formatted.trim();
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
  const formattedDescription = formatIncidentDescription(group.description);

  return (
    <div
      className={cn(
        'group min-w-0 overflow-hidden transition-colors hover:bg-bg-subtle/30',
        isCritical ? 'bg-error/[0.02]' : 'bg-warning/[0.02]',
      )}
    >
      <div className="p-4 lg:p-5">
        <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-y-2 gap-x-4">
          <div className="flex shrink-0 items-center gap-2 text-[13px]">
            <span className="font-medium text-secondary-ol">{projectName}</span>
            <span className="text-muted-ol/50">/</span>
            <span
              className="max-w-[120px] sm:max-w-none truncate font-mono text-[12px] text-muted-ol/80"
              title={incidentProjectId}
            >
              {incidentProjectId}
            </span>
            <Badge
              variant="outline"
              className={cn(
                'ml-2 h-5 rounded-md px-2 text-[10px] font-bold uppercase tracking-wider border-0 shadow-none',
                isCritical ? 'text-error bg-error/10' : 'text-warning bg-warning/10',
                group.status === 'resolved' && 'text-success bg-success/10',
              )}
            >
              {t(group.status.replace('_', ' '))}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 text-[12px] font-mono text-muted-ol">
            <span className="text-secondary-ol">
              {t('ops.occurrences', { count: String(group.count) })}
            </span>
            <span className="opacity-40">&middot;</span>
            <span>{relativeTime(group.lastSeen, language)}</span>
          </div>
        </div>

        <div className="flex items-start gap-3 mt-1">
          <div className="mt-1 shrink-0">
            {isCritical ? (
              <XCircle className="h-4 w-4 text-error" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-warning" />
            )}
          </div>
          <div className="flex-1 w-full min-w-0">
            <h4
              className={cn(
                'text-[15px] font-semibold font-body mb-1.5 tracking-tight',
                isCritical ? 'text-error' : 'text-warning',
              )}
            >
              {formatIncidentTitle(t(group.label))}
            </h4>
            <div className="w-full">
              <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[13px] text-secondary-ol/90 font-body prose-p:leading-relaxed prose-p:mb-3 last:prose-p:mb-0 prose-headings:text-primary-ol prose-headings:text-[14px] prose-headings:font-bold prose-headings:mb-2 prose-headings:mt-4 first:prose-headings:mt-0 prose-a:text-agent prose-a:no-underline hover:prose-a:underline prose-code:bg-bg-subtle prose-code:text-primary-ol prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded pt-1 prose-code:before:content-none prose-code:after:content-none prose-code:font-mono prose-code:text-[11.5px] prose-strong:text-primary-ol prose-strong:font-semibold prose-pre:bg-bg-subtle prose-pre:border prose-pre:border-border/40 prose-pre:text-[11.5px] prose-pre:rounded-md prose-pre:p-3 prose-ul:pl-4 prose-ol:pl-4 prose-li:my-0.5 prose-li:leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{formattedDescription}</ReactMarkdown>
              </div>
            </div>

            <div className="mt-4">
              <Collapsible open={isOpen} onOpenChange={handleOpenChange} className="w-full min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-3 bg-transparent text-xs text-secondary-ol hover:bg-bg-subtle font-medium border-border/60 hover:text-primary-ol"
                    >
                      {t('ops.viewTimeline')}
                      <ChevronDown
                        className={cn(
                          'ml-1.5 h-3.5 w-3.5 transition-transform',
                          isOpen && 'rotate-180',
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-3 text-xs text-muted-ol hover:text-secondary-ol hover:bg-bg-subtle"
                    onClick={() => toast.info(t('ops.featureNotReady'))}
                  >
                    {t('ops.acknowledge')}
                  </Button>
                </div>

                <CollapsibleContent className="mt-3 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in">
                  <div className="rounded-lg border border-border bg-bg-panel/50 p-4 shadow-sm">
                    <h5 className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-ol">
                      <RefreshCw className="h-3 w-3" />
                      {t('ops.latestTimeline')}
                    </h5>

                    {loadingEvents ? (
                      <div className="flex items-center justify-center py-4">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-ol" />
                      </div>
                    ) : (
                      <IncidentTimeline events={events} />
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
