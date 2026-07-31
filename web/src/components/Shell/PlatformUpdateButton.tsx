import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { useAppData } from '@/hooks/use-app-data';
import { isPlatformUpdateActive } from '@/hooks/use-platform-update';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

export function PlatformUpdateButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useLanguage();
  const { platformUpdateState, setPlatformUpdateDialogOpen } = useAppData();
  const status = platformUpdateState.status;
  const operation = status?.operation ?? null;
  const active = isPlatformUpdateActive(operation) || platformUpdateState.reconnecting;
  const rolledBack = operation?.phase === 'rolled_back';
  const failed = operation?.phase === 'failed';
  if (!status) return null;

  const targetVersion = operation?.targetVersion ?? status.release?.version ?? '';
  const label = active
    ? t('platformUpdate.button.progress')
    : rolledBack
      ? t('platformUpdate.button.rolledBack')
      : failed
        ? t('platformUpdate.button.failed')
        : status.updateAvailable
          ? t('platformUpdate.button.available', { version: targetVersion })
          : status.releaseCheckStale
            ? t('platformUpdate.button.checkUnavailable')
            : t('platformUpdate.button.upToDate', { version: status.currentVersion });
  const Icon = active
    ? LoaderCircle
    : rolledBack
      ? RotateCcw
      : failed
        ? AlertCircle
        : status.updateAvailable
          ? ArrowUpCircle
          : status.releaseCheckStale
            ? RefreshCw
            : CheckCircle2;
  const attention =
    active || rolledBack || failed || status.updateAvailable || status.releaseCheckStale;
  const button = (
    <button
      type="button"
      onClick={() => setPlatformUpdateDialogOpen(true)}
      aria-label={label}
      className={cn(
        'relative flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors',
        failed
          ? 'border-[color:var(--ol-error)]/40 bg-[color:var(--ol-error)]/10 text-[color:var(--ol-error)]'
          : attention
            ? 'border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning)]/10 text-[color:var(--ol-fg)] hover:bg-[color:var(--ol-warning)]/15'
            : 'border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'animate-spin')} />
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
      {collapsed && (
        <span
          aria-hidden
          className={cn(
            'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
            failed
              ? 'bg-[color:var(--ol-error)]'
              : attention
                ? 'bg-[color:var(--ol-warning)]'
                : 'bg-[color:var(--ol-success)]',
          )}
        />
      )}
    </button>
  );

  return collapsed ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
