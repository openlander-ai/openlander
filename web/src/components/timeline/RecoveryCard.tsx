import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import { AlertTriangle, XCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { TimelineItem } from '@/lib/event-types';
import { useLanguage } from '@/i18n/context.js';

interface RecoveryCardProps {
  item: TimelineItem;
  isLatest?: boolean;
}

export function RecoveryCard({ item, isLatest }: RecoveryCardProps) {
  const { t } = useLanguage();
  const isStart = item.type === 'recovery_start';
  const isSuccess = item.type === 'recovery_success';
  const isFailed = item.type === 'recovery_failed';
  const isExhausted = item.type === 'recovery_exhausted';

  // Determine top section icon and color based on state, though prompt asks for red/destructive
  // We'll use destructive for the diagnosis area as requested.
  const TopIcon = isSuccess
    ? CheckCircle2
    : isStart
      ? RefreshCw
      : isExhausted
        ? AlertTriangle
        : XCircle;
  const topColorClass = isSuccess ? 'text-success' : 'text-destructive';
  const topBorderClass = isSuccess ? 'border-success/20' : 'border-destructive/20';
  const topBgClass = isSuccess ? 'bg-success/5' : 'bg-destructive/5';

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border overflow-hidden transition-all duration-300 timeline-item-enter',
        isSuccess ? 'border-success/20' : 'border-destructive/20',
        isLatest && isStart && 'glow-agent',
      )}
    >
      {/* Top: Diagnosis Area */}
      <div className={cn('p-4 flex gap-3.5', topBgClass)}>
        <div className="shrink-0 mt-0.5 relative z-10">
          <div className={cn('p-1.5 rounded-md border', topBgClass, topBorderClass)}>
            <TopIcon
              className={cn('h-3.5 w-3.5', topColorClass, isStart && isLatest && 'animate-spin')}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn('text-sm font-medium leading-snug whitespace-pre-wrap', topColorClass)}
            >
              {isSuccess
                ? item.title
                : `${t('timeline.buildFailed')}: ${item.title.replace(/^빌드 실패:\s*/, '')}`}
            </p>
            <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5 opacity-70">
              {formatTime(item.timestamp)}
            </span>
          </div>

          {item.detail && (
            <div className="mt-2">
              <details className="group/log" open={isLatest || isFailed || isExhausted}>
                <summary
                  className={cn(
                    'text-xs font-mono cursor-pointer transition-colors select-none',
                    topColorClass,
                    'opacity-80 hover:opacity-100',
                  )}
                >
                  {t('timeline.detailedCauseExplanation')}
                </summary>
                <pre
                  className={cn(
                    'mt-1.5 text-xs font-mono bg-bg-terminal border rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed',
                    isSuccess
                      ? 'border-success/10 text-success/90'
                      : 'border-destructive/10 text-destructive/90',
                  )}
                >
                  {item.detail}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Prescription Area */}
      <div className="p-4 border-t border-border/50 bg-agent/5 flex gap-3.5">
        <div className="shrink-0 mt-0.5 relative z-10">
          <div className="p-1.5 rounded-md bg-agent/10 border border-agent/20">
            <RefreshCw className="h-3.5 w-3.5 text-agent" />
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-medium text-agent leading-snug">
            {isSuccess
              ? t('timeline.recovery.complete')
              : isStart
                ? t('timeline.recovery.inProgress')
                : t('timeline.recovery.options')}
            {item.tokenCount != null && (
              <span className="text-xs text-muted-foreground ml-2 font-normal">
                — {t('timeline.tokenCount', { count: item.tokenCount.toLocaleString() })}
                {item.costUsd != null && item.costUsd > 0 && (
                  <span> (${item.costUsd.toFixed(3)})</span>
                )}
              </span>
            )}
          </p>

          {item.actionButtons && item.actionButtons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.actionButtons.map((btn, idx) => (
                <button
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-agent/10 hover:bg-agent/20 border border-agent/20 text-xs font-medium text-agent transition-colors"
                  onClick={() => {
                    void btn;
                  }}
                >
                  <span>{btn.label}</span>
                  {idx < 3 && (
                    <kbd className="px-1.5 py-0.5 rounded bg-agent/20 text-[10px] font-mono border border-agent/10">
                      {idx + 1}
                    </kbd>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
