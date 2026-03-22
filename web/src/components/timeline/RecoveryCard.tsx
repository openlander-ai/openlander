import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
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

  return (
    <div
      className={cn(
        'relative flex gap-3.5 py-3.5 px-4 rounded-lg transition-all duration-300 timeline-item-enter border border-transparent',
        isStart && 'bg-indigo-500/5 border-indigo-500/10',
        isSuccess && 'bg-success/5 border-success/10 glow-success',
        isFailed && 'bg-error/5 border-error/10 glow-error',
        isExhausted && 'bg-amber-500/5 border-amber-500/10 glow-warning',
        isLatest && isStart && 'glow-agent',
      )}
    >
      <div className="shrink-0 mt-0.5 relative z-10">
        {isStart && (
          <div className="p-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/20">
            <RefreshCw className={cn('h-3.5 w-3.5 text-indigo-400', isLatest && 'animate-spin')} />
          </div>
        )}
        {isSuccess && (
          <div className="p-1.5 rounded-md bg-success/10 border border-success/20 relative">
            <div className="absolute inset-0 rounded-md bg-success/20 animate-ping opacity-20" />
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          </div>
        )}
        {isFailed && (
          <div className="p-1.5 rounded-md bg-error/10 border border-error/20">
            <XCircle className="h-3.5 w-3.5 text-error" />
          </div>
        )}
        {isExhausted && (
          <div className="p-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-body leading-snug whitespace-pre-wrap',
              isStart && 'text-indigo-400 font-medium',
              isSuccess && 'text-success font-medium',
              isFailed && 'text-error font-medium',
              isExhausted && 'text-amber-500 font-medium',
            )}
          >
            {item.title}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5 opacity-70">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {(isStart || isFailed) && item.detail && (
          <details className="mt-2 group/log" open={isLatest}>
            <summary className="text-[11px] font-mono text-error/70 cursor-pointer hover:text-error transition-colors select-none">
              Error details ▾
            </summary>
            <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-bg-terminal border border-error/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
              {item.detail}
            </pre>
          </details>
        )}

        {isExhausted && item.detail && (
          <div className="mt-2 text-xs text-amber-500/80 bg-amber-500/5 border border-amber-500/10 rounded-md p-2.5">
            <p className="font-medium mb-1">Manual intervention needed</p>
            <p className="font-mono text-[10px]">{item.detail}</p>
          </div>
        )}

        {(isFailed || isExhausted) && (
          <DiagnoseButton
            className="mt-2"
            projectId={item.sourceProjectId}
            errorMessage={item.detail ?? item.title}
            logLines={item.detail ? item.detail.split('\n').slice(-40) : undefined}
          />
        )}
      </div>
    </div>
  );
}
