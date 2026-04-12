import { Clock } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { ActivityItem } from '../../../lib/api/operations.js';

interface ApprovalCountWidgetProps {
  approvals: ActivityItem[];
  onFilter?: () => void;
}

const URGENT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isUrgent(approvals: ActivityItem[]): boolean {
  const now = Date.now();
  return approvals.some((a) => {
    const ts = new Date(a.timestamp).getTime();
    return now - ts > URGENT_THRESHOLD_MS;
  });
}

export function ApprovalCountWidget({ approvals, onFilter }: ApprovalCountWidgetProps) {
  const { t } = useLanguage();

  const count = approvals.length;
  const urgent = count > 0 && isUrgent(approvals);
  const hasAny = count > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>{t('opsV2.widgets.approvals.title')}</span>
      </div>

      {!hasAny && (
        <p className="px-1 text-xs text-muted-foreground">{t('opsV2.widgets.approvals.empty')}</p>
      )}

      {hasAny && (
        <button
          type="button"
          onClick={onFilter}
          disabled={!onFilter}
          className={cn(
            'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors',
            urgent
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-warning hover:bg-warning/10',
            onFilter ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <span className="flex items-center gap-1.5">
            {urgent && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
              </span>
            )}
            {!urgent && <span className="h-2 w-2 rounded-full bg-warning" />}
            <span>{urgent ? t('opsV2.widgets.approvals.urgent') : t('opsV2.rail.approvals')}</span>
          </span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
              urgent ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning',
            )}
          >
            {t('opsV2.widgets.approvals.pending', { count })}
          </span>
        </button>
      )}
    </div>
  );
}
