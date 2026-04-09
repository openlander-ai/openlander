import { AlertCircle } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import type { OpsIncident } from '../../../lib/api/operations.js';

interface IncidentsSummaryWidgetProps {
  incidents: OpsIncident[];
  onFilter?: (severity: string) => void;
}

const SEVERITY_ORDER = ['critical', 'warning', 'info'] as const;
type SeverityLevel = (typeof SEVERITY_ORDER)[number];

const SEVERITY_STYLES: Record<SeverityLevel, { dot: string; row: string; label: string }> = {
  critical: {
    dot: 'bg-destructive',
    row: 'text-destructive hover:bg-destructive/10',
    label: 'opsV2.widgets.incidents.critical',
  },
  warning: {
    dot: 'bg-warning',
    row: 'text-warning hover:bg-warning/10',
    label: 'opsV2.widgets.incidents.warning',
  },
  info: {
    dot: 'bg-muted-foreground',
    row: 'text-muted-foreground hover:bg-muted/20',
    label: 'opsV2.widgets.incidents.info',
  },
};

export function IncidentsSummaryWidget({ incidents, onFilter }: IncidentsSummaryWidgetProps) {
  const { t } = useLanguage();

  const counts = incidents.reduce<Record<SeverityLevel, number>>(
    (acc, inc) => {
      const sev = inc.severity as SeverityLevel;
      if (sev in acc) {
        acc[sev] += 1;
      }
      return acc;
    },
    { critical: 0, warning: 0, info: 0 },
  );

  const hasAny = incidents.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <AlertCircle className="h-3 w-3" />
        <span>{t('opsV2.widgets.incidents.title')}</span>
      </div>

      {!hasAny && (
        <p className="px-1 text-xs text-muted-foreground">{t('opsV2.widgets.incidents.empty')}</p>
      )}

      {hasAny &&
        SEVERITY_ORDER.map((sev) => {
          const count = counts[sev];
          if (count === 0) return null;
          const styles = SEVERITY_STYLES[sev];
          return (
            <button
              key={sev}
              type="button"
              onClick={() => onFilter?.(sev)}
              disabled={!onFilter}
              className={cn(
                'flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors',
                styles.row,
                onFilter ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', styles.dot)} />
                {t(styles.label)}
              </span>
              <span className="font-semibold tabular-nums">{count}</span>
            </button>
          );
        })}
    </div>
  );
}
