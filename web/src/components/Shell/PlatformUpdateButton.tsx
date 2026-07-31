import { AlertCircle, ArrowUpCircle, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
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

  const completedHasNewerRelease =
    operation?.phase === 'completed' &&
    status.updateAvailable &&
    operation.targetVersion !== status.release?.version;
  const targetVersion = completedHasNewerRelease
    ? (status.release?.version ?? '')
    : (operation?.targetVersion ?? status.release?.version ?? '');
  const available = status.updateAvailable && !active && !rolledBack && !failed;
  const checkUnavailable =
    status.releaseCheckStale && !active && !rolledBack && !failed && !available;
  if (!active && !rolledBack && !failed && !available && !checkUnavailable) return null;

  const label = active
    ? t('platformUpdate.button.progress')
    : rolledBack
      ? t('platformUpdate.button.rolledBack')
      : failed
        ? t('platformUpdate.button.failed')
        : status.updateAvailable
          ? t('platformUpdate.button.available', { version: targetVersion })
          : t('platformUpdate.button.checkUnavailable');
  const availableTitle = t('platformUpdate.button.availableTitle');
  const Icon = active
    ? LoaderCircle
    : rolledBack
      ? RotateCcw
      : failed
        ? AlertCircle
        : status.updateAvailable
          ? ArrowUpCircle
          : RefreshCw;
  const button = (
    <button
      type="button"
      onClick={() => setPlatformUpdateDialogOpen(true)}
      aria-label={label}
      className={cn(
        'relative flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)]/40',
        failed
          ? 'border-[color:var(--ol-error)]/40 bg-[color:var(--ol-error)]/10 text-[color:var(--ol-error)]'
          : available
            ? 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg)] hover:border-[color:var(--ol-primary)]/40 hover:bg-[color:var(--ol-primary-soft)]'
            : 'border-[color:var(--ol-warning)]/40 bg-[color:var(--ol-warning)]/10 text-[color:var(--ol-fg)] hover:bg-[color:var(--ol-warning)]/15',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          active && 'animate-spin',
          available && 'text-[color:var(--ol-primary)]',
        )}
      />
      {!collapsed &&
        (available ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-left text-[color:var(--ol-primary)]">
              {availableTitle}
            </span>
            <span className="ol-mono shrink-0 text-[11px] font-normal text-[color:var(--ol-fg-muted)]">
              v{targetVersion}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        ))}
      {collapsed && (
        <span
          aria-hidden
          className={cn(
            'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full',
            failed
              ? 'bg-[color:var(--ol-error)]'
              : available
                ? 'bg-[color:var(--ol-primary)]'
                : 'bg-[color:var(--ol-warning)]',
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
