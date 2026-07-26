/**
 * CancelledSummary — terminal card shown when the user kills a build.
 *
 * Distinct from FailureSummary: a cancelled build did NOT fail
 * inherently — the user chose to stop it. The previous deploy continues
 * to serve traffic, so we say so explicitly to reduce panic.
 */
import { Copy, RefreshCw, StopCircle } from 'lucide-react';
import { useLanguage } from '@/i18n/context';

export interface CancelledSummaryProps {
  onRedeploy?: () => void;
  onCopyPartialLog?: () => void;
}

export function CancelledSummary({ onRedeploy, onCopyPartialLog }: CancelledSummaryProps) {
  const { t } = useLanguage();

  return (
    <div
      role="status"
      className="rounded-md border-l-2 border-[color:var(--ol-fg-subtle)] bg-[color:var(--ol-panel-2)] p-4"
    >
      <h4 className="flex items-center gap-2 text-[13.5px] font-semibold text-[color:var(--ol-fg)]">
        <StopCircle className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
        {t('deployShell.cancelled.title')}
      </h4>
      <p className="mt-1 text-[12.5px] text-[color:var(--ol-fg-muted)]">
        {t('deployShell.cancelled.description')}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRedeploy}
          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <RefreshCw className="h-3 w-3" />
          {t('deployShell.cancelled.redeploy')}
        </button>
        <button
          type="button"
          onClick={onCopyPartialLog}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
        >
          <Copy className="h-3 w-3" />
          {t('deployShell.cancelled.copyPartialLog')}
        </button>
      </div>
    </div>
  );
}

export default CancelledSummary;
