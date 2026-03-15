import { useLanguage } from '@/i18n/context';
import type { TimelineItem } from '@/lib/event-types';
import { isErrorAnalysisResult } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import { Search, CheckCircle2 } from 'lucide-react';

interface ErrorAnalysisCardProps {
  item: TimelineItem;
}

export function ErrorAnalysisCard({ item }: ErrorAnalysisCardProps) {
  const { t } = useLanguage();

  const result = item.toolResult;
  if (!isErrorAnalysisResult(result)) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        'bg-error/5 border-error/20',
      )}
    >
      <div className="shrink-0 mt-0.5">
        <div className="p-1.5 rounded-md bg-error/10">
          <Search className="h-3.5 w-3.5 text-error" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium font-body leading-snug text-error">
            {t('timeline.errorAnalysis.title')}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        <div className="mt-2 space-y-3">
          <p className="text-sm font-body text-primary-ol leading-relaxed">{result.summary}</p>

          <div className="space-y-1">
            <p className="text-[11px] font-mono text-error/80 uppercase tracking-wider">
              {t('timeline.errorAnalysis.rootCause')}
            </p>
            <p className="text-xs font-body text-secondary-ol bg-error/5 p-2 rounded border border-error/10">
              {result.rootCause}
            </p>
          </div>

          {result.suggestedFixes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">
                {t('timeline.errorAnalysis.suggestedFixes')}
              </p>
              <ul className="space-y-2">
                {result.suggestedFixes.map((fix, i) => (
                  <li
                    key={i}
                    className="text-xs font-body text-secondary-ol bg-bg-subtle/50 p-2.5 rounded border border-border flex flex-col gap-1.5"
                  >
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-agent shrink-0 mt-0.5" />
                      <span className="text-primary-ol leading-snug">{fix.description}</span>
                    </div>

                    <div className="flex items-center gap-3 ml-5.5 pl-0.5">
                      {fix.location && (
                        <span className="text-[10px] font-mono text-muted-ol bg-bg-app px-1.5 py-0.5 rounded border border-border">
                          {fix.location}
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-[10px] font-medium px-1.5 py-0.5 rounded',
                          fix.confidence === 'high'
                            ? 'bg-success/10 text-success'
                            : fix.confidence === 'medium'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-error/10 text-error',
                        )}
                      >
                        {t('timeline.errorAnalysis.confidence')}: {fix.confidence}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.detail && (
            <details className="mt-3 group/detail">
              <summary className="text-[11px] font-mono text-error/70 cursor-pointer hover:text-error transition-colors select-none">
                {t('timeline.errorAnalysis.viewDetails')}
              </summary>
              <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-error/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
                {item.detail}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
