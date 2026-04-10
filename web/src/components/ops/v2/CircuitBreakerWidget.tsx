import { useState } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';
import { resetCircuitBreaker } from '../../../lib/api/operations.js';
import type { CircuitBreakerWithProject } from '../../../lib/api/operations.js';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

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

function CircuitBreakerItem({ cb }: { cb: CircuitBreakerWithProject }) {
  const { t } = useLanguage();
  const [isResetting, setIsResetting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const state = cb.state as 'open' | 'half_open' | 'closed';
  const styles = STATE_STYLES[state] ?? STATE_STYLES.closed;
  const isOpen = state === 'open';

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetCircuitBreaker(cb.projectId);
      toast.success(t('opsV2.widgets.circuitBreakers.resetSuccess'));
      setShowConfirm(false);
    } catch {
      toast.error(t('opsV2.widgets.circuitBreakers.resetError'));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-bg-subtle transition-colors group">
        <span className="min-w-0 flex-1 truncate text-foreground" title={cb.projectName}>
          {cb.projectName}
        </span>
        <div className="flex items-center gap-1">
          {isOpen && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-bg-panel rounded text-muted-foreground hover:text-foreground"
              title={t('opsV2.widgets.circuitBreakers.reset')}
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          <span
            className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold', styles.badge)}
          >
            {t(styles.label)}
          </span>
        </div>
      </div>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('opsV2.widgets.circuitBreakers.resetConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('opsV2.widgets.circuitBreakers.resetConfirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfirm(false)}
              disabled={isResetting}
            >
              {t('opsV2.approvals.confirmCancel')}
            </Button>
            <Button size="sm" onClick={() => void handleReset()} disabled={isResetting}>
              {isResetting ? <RefreshCw className="h-3 w-3 animate-spin mr-2" /> : null}
              {t('opsV2.widgets.circuitBreakers.reset')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
          {visible.map((cb) => (
            <CircuitBreakerItem key={cb.projectId} cb={cb} />
          ))}

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
