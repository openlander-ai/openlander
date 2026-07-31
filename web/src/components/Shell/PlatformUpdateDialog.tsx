import { useEffect, useRef } from 'react';
import {
  Check,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAppData } from '@/hooks/use-app-data';
import { isPlatformUpdateActive } from '@/hooks/use-platform-update';
import { useLanguage } from '@/i18n/context';
import { ApiError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

const PHASES = ['preparing', 'backing_up', 'pulling', 'restarting', 'verifying'] as const;

export function PlatformUpdateDialog() {
  const { t } = useLanguage();
  const { platformUpdateState, platformUpdateDialogOpen, setPlatformUpdateDialogOpen } =
    useAppData();
  const status = platformUpdateState.status;
  const operation = status?.operation ?? null;
  const previousPhase = useRef(operation?.phase);

  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = operation?.phase;
    if (!before || before === operation?.phase) return;
    if (operation?.phase === 'completed') toast.success(t('platformUpdate.toast.completed'));
    if (operation?.phase === 'rolled_back') toast.warning(t('platformUpdate.toast.rolledBack'));
    if (operation?.phase === 'failed') toast.error(t('platformUpdate.toast.failed'));
  }, [operation?.phase, t]);

  if (!status) return null;
  const active = isPlatformUpdateActive(operation) || platformUpdateState.reconnecting;
  const targetVersion = operation?.targetVersion ?? status.release?.version ?? '';
  const currentPhaseIndex = operation
    ? PHASES.indexOf(operation.phase as (typeof PHASES)[number])
    : -1;
  const rolledBack = operation?.phase === 'rolled_back';
  const failed = operation?.phase === 'failed';
  const terminal = operation?.phase === 'completed' || rolledBack || failed;
  const manualRequired =
    status.updateAvailable &&
    (status.support.mode === 'manual' || Boolean(status.release?.oneClickBlockReason));

  const onUpdate = async () => {
    if (!targetVersion) return;
    try {
      await platformUpdateState.startUpdate(targetVersion);
    } catch (error) {
      if (error instanceof ApiError) toast.error(t('platformUpdate.toast.startFailed'));
    }
  };

  const onCheckNow = async () => {
    try {
      await platformUpdateState.checkNow();
    } catch {
      toast.error(t('platformUpdate.toast.checkFailed'));
    }
  };

  return (
    <Dialog open={platformUpdateDialogOpen} onOpenChange={setPlatformUpdateDialogOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('platformUpdate.dialog.title')}</DialogTitle>
          <DialogDescription>{t('platformUpdate.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="mt-5 space-y-5">
          <div className="flex items-center gap-3 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                {t('platformUpdate.dialog.currentVersion')}
              </div>
              <div className="font-mono text-sm">v{status.currentVersion}</div>
            </div>
            {status.updateAvailable || operation ? (
              <>
                <span aria-hidden className="text-[color:var(--ol-fg-subtle)]">
                  →
                </span>
                <div className="min-w-0 flex-1 text-right">
                  <div className="text-[11px] uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                    {t('platformUpdate.dialog.targetVersion')}
                  </div>
                  <div className="font-mono text-sm">v{targetVersion}</div>
                </div>
              </>
            ) : (
              <div
                className={cn(
                  'flex items-center gap-2 text-sm',
                  status.releaseCheckStale
                    ? 'text-[color:var(--ol-warning)]'
                    : 'text-[color:var(--ol-success)]',
                )}
              >
                {status.releaseCheckStale ? (
                  <CircleAlert className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                {status.releaseCheckStale
                  ? t('platformUpdate.dialog.statusUnavailable')
                  : t('platformUpdate.dialog.upToDate')}
              </div>
            )}
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2">
            <div className="min-w-0 text-xs text-[color:var(--ol-fg-muted)]">
              <p>
                {t('platformUpdate.dialog.checkedAt', {
                  time: formatDateTime(status.releaseCheckedAt),
                })}
              </p>
              {status.releaseCheckStale && (
                <p className="mt-1 text-[color:var(--ol-warning)]">
                  {t('platformUpdate.dialog.releaseCheckStale')}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void onCheckNow()}
              disabled={platformUpdateState.checking || active}
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5', platformUpdateState.checking && 'animate-spin')}
              />
              {platformUpdateState.checking
                ? t('platformUpdate.dialog.checking')
                : t('platformUpdate.dialog.checkNow')}
            </Button>
          </div>

          {active || terminal ? (
            <div className="space-y-3" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-medium">
                {active && (
                  <LoaderCircle className="h-4 w-4 animate-spin text-[color:var(--ol-primary)]" />
                )}
                {rolledBack && <RotateCcw className="h-4 w-4 text-[color:var(--ol-warning)]" />}
                {failed && <CircleAlert className="h-4 w-4 text-[color:var(--ol-error)]" />}
                {operation && t(`platformUpdate.phase.${operation.phase}`)}
              </div>
              {!terminal && (
                <ol
                  className="grid grid-cols-5 gap-1"
                  aria-label={t('platformUpdate.dialog.progress')}
                >
                  {PHASES.map((phase, index) => (
                    <li key={phase} className="min-w-0">
                      <div
                        className={cn(
                          'h-1.5 rounded-full bg-[color:var(--ol-border-subtle)]',
                          index <= currentPhaseIndex && 'bg-[color:var(--ol-primary)]',
                        )}
                      />
                      <span className="sr-only">{t(`platformUpdate.phase.${phase}`)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {rolledBack && (
                <p className="rounded-md bg-[color:var(--ol-warning)]/10 p-3 text-sm text-[color:var(--ol-fg-muted)]">
                  {t('platformUpdate.dialog.rolledBackHelp')}
                </p>
              )}
              {failed && (
                <p className="rounded-md bg-[color:var(--ol-error)]/10 p-3 text-sm text-[color:var(--ol-error)]">
                  {t('platformUpdate.dialog.failedHelp')}
                </p>
              )}
              {platformUpdateState.disconnected && (
                <p className="text-xs text-[color:var(--ol-fg-muted)]">
                  {t('platformUpdate.dialog.reconnecting')}
                </p>
              )}
            </div>
          ) : status.updateAvailable ? (
            <>
              {status.release && status.release.notes.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                    {t('platformUpdate.dialog.changes')}
                  </h3>
                  <ul className="space-y-1.5 text-sm text-[color:var(--ol-fg-muted)]">
                    {status.release.notes.slice(0, 5).map((note) => (
                      <li key={note} className="flex gap-2">
                        <span aria-hidden>•</span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                  {t('platformUpdate.dialog.preflight')}
                </h3>
                <ul className="space-y-2">
                  {status.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2 text-sm">
                      {check.ok ? (
                        <Check className="mt-0.5 h-4 w-4 text-[color:var(--ol-success)]" />
                      ) : (
                        <X className="mt-0.5 h-4 w-4 text-[color:var(--ol-warning)]" />
                      )}
                      <span>
                        {t(`platformUpdate.checks.${check.id}.${check.ok ? 'pass' : 'fail'}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <p className="rounded-md bg-[color:var(--ol-primary-soft)] px-3 py-2 text-xs text-[color:var(--ol-fg-muted)]">
                {t('platformUpdate.dialog.reconnectNotice')}
              </p>
            </>
          ) : (
            <p className="text-sm text-[color:var(--ol-fg-muted)]">
              {status.releaseCheckStale
                ? t('platformUpdate.dialog.noFreshReleaseData')
                : t('platformUpdate.dialog.noUpdateAvailable')}
            </p>
          )}
        </div>

        <DialogFooter>
          {manualRequired ? (
            <Button asChild>
              <a href={status.support.manualUpdateUrl} target="_blank" rel="noreferrer">
                {t('platformUpdate.dialog.manualUpdate')}
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          ) : status.updateAvailable && !active && operation?.phase !== 'completed' ? (
            <Button
              onClick={() => void onUpdate()}
              disabled={!status.canUpdate || platformUpdateState.submitting}
            >
              {platformUpdateState.submitting
                ? t('platformUpdate.dialog.starting')
                : rolledBack || failed
                  ? t('platformUpdate.dialog.retry')
                  : t('platformUpdate.dialog.updateNow')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
