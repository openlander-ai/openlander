import { useState } from 'react';
import type { TimelineItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { Info, AlertTriangle, AlertCircle, Loader2 } from 'lucide-react';

interface InsightCardProps {
  item: TimelineItem;
  onAction?: (projectId: string, action: string) => Promise<void>;
}

const severityConfig = {
  info: {
    bg: 'bg-agent/5',
    border: 'border-agent/15',
    icon: Info,
    iconBg: 'bg-agent/15',
    iconColor: 'text-agent',
    titleColor: 'text-primary-ol',
    btnBg: 'bg-agent/10 hover:bg-agent/20 border-agent/20 text-agent',
  },
  warning: {
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    icon: AlertTriangle,
    iconBg: 'bg-warning/15',
    iconColor: 'text-warning',
    titleColor: 'text-warning',
    btnBg: 'bg-warning/10 hover:bg-warning/20 border-warning/20 text-warning',
  },
  error: {
    bg: 'bg-error/5',
    border: 'border-error/20',
    icon: AlertCircle,
    iconBg: 'bg-error/15',
    iconColor: 'text-error',
    titleColor: 'text-error',
    btnBg: 'bg-error/10 hover:bg-error/20 border-error/20 text-error',
  },
} as const;

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function InsightCard({ item, onAction }: InsightCardProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const severity = item.severity ?? 'info';
  const config = severityConfig[severity];
  const Icon = config.icon;

  const handleAction = async (action: string) => {
    if (!onAction || loadingAction) return;
    setLoadingAction(action);
    try {
      await onAction(item.id, action);
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        config.bg,
        config.border,
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className={cn('p-1 rounded-md', config.iconBg)}>
          <Icon className={cn('h-3.5 w-3.5', config.iconColor)} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm font-body leading-snug', config.titleColor)}>{item.title}</p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {item.detail && (
          <p className="mt-1 text-xs font-body text-secondary-ol leading-relaxed">{item.detail}</p>
        )}

        {/* Action buttons */}
        {item.actionButtons && item.actionButtons.length > 0 && (
          <div className="flex items-center gap-2 mt-2.5">
            {item.actionButtons.map((btn) => (
              <button
                key={btn.action}
                onClick={() => void handleAction(btn.action)}
                disabled={loadingAction !== null}
                className={cn(
                  'px-2.5 py-1 rounded text-[11px] font-body border transition-colors',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  config.btnBg,
                )}
              >
                {loadingAction === btn.action ? (
                  <Loader2 className="h-3 w-3 animate-spin inline-block mr-1" />
                ) : null}
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
