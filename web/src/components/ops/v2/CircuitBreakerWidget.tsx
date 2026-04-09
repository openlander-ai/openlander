import { ShieldAlert } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { CircuitBreakerWithProject } from '../../../lib/api/operations.js';

interface CircuitBreakerWidgetProps {
  circuitBreakers: CircuitBreakerWithProject[];
  onFilter?: () => void;
}

const MAX_VISIBLE = 3;

const STATE_STYLES: Record<'open' | 'half_open' | 'closed', { badge: string; label: string }> = {
  open: {
    badge: 'bg-destructive/15 text-destructive',
    label: 'opsV2.widgets.circuitBreakers.open',
  },
  half_open: {
    badge: 'bg-warning/15 text-warning',
    label: 'opsV2.widgets.circuitBreakers.halfOpen',
  },
  closed: {
    badge: 'bg-success/15 text-success',
    label: 'opsV2.widgets.circuitBreakers.closed',
  },
};

export function CircuitBreakerWidget({ circuitBreakers, onFilter }: CircuitBreakerWidgetProps) {
  const { t } = useLanguage();

  const visible = circuitBreakers.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, circuitBreakers.length - MAX_VISIBLE);
  const hasAny = circuitBreakers.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldAlert className="h-3 w-3" />
        <span>{t('opsV2.widgets.circuitBreakers.title')}</span>
      </div>

      {!hasAny && (
        <p className="px-1 text-xs text-muted-foreground">
          {t('opsV2.widgets.circuitBreakers.empty')}
        </p>
      )}

      {hasAny && (
        <div className="flex flex-col gap-0.5">
          {visible.map((cb) => {
            const state = cb.state as 'open' | 'half_open' | 'closed';
            const styles = STATE_STYLES[state] ?? STATE_STYLES.closed;
            return (
              <div
                key={cb.projectId}
                className="flex items-center justify-between rounded px-2 py-1 text-xs"
              >
                <span className="min-w-0 flex-1 truncate text-foreground" title={cb.projectName}>
                  {cb.projectName}
                </span>
                <span
                  className={cn(
                    'ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                    styles.badge,
                  )}
                >
                  {t(styles.label)}
                </span>
              </div>
            );
          })}

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={onFilter}
              disabled={!onFilter}
              className={cn(
                'rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground',
                onFilter ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              {t('opsV2.widgets.circuitBreakers.showMore', { count: hiddenCount })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
