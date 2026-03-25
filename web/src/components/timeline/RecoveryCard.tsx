import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import { AlertTriangle, Sparkles, XCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { TimelineItem } from '@/lib/event-types';
import { DiagnoseButton } from '@/components/agent/DiagnoseButton';

interface RecoveryCardProps {
  item: TimelineItem;
  isLatest?: boolean;
}

export function RecoveryCard({ item, isLatest }: RecoveryCardProps) {
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
              {isSuccess ? item.title : `빌드 실패: ${item.title.replace(/^빌드 실패:\s*/, '')}`}
            </p>
            <span className="text-xs font-mono text-muted-ol shrink-0 mt-0.5 opacity-70">
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
                  구체적 원인 설명 ▾
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
            <Sparkles className="h-3.5 w-3.5 text-agent" />
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-medium text-agent leading-snug">
            {isSuccess ? 'AI 복구 완료' : isStart ? 'AI 복구 진행 중...' : 'AI 복구 옵션'}
          </p>

          {item.actionButtons && item.actionButtons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.actionButtons.map((btn, idx) => (
                <button
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-agent/10 hover:bg-agent/20 border border-agent/20 text-xs font-medium text-agent transition-colors"
                  onClick={() => {
                    // Action handling would go here, but we just need to render it for now
                    console.log('Action clicked:', btn.action);
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

          {(isFailed || isExhausted) && (
            <DiagnoseButton
              className="mt-3"
              projectId={item.sourceProjectId}
              errorMessage={item.detail ?? item.title}
              logLines={item.detail ? item.detail.split('\n').slice(-40) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
