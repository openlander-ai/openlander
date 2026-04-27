/**
 * LogViewerSummaryCards — terminal-state cards rendered below the
 * scroll area. Extracted from LogViewer (PR7-F) so the parent stays
 * focused on stream + virtualizer concerns.
 *
 * Picks one of:
 *   - FailureSummary  (ENDED + buildOutcome=fail)
 *   - SuccessSummary  (ENDED + buildOutcome=success)
 *   - CancelledSummary (CANCELLED — user kill OR backend cancel)
 *
 * Returns null for any other state. Runtime variant never renders any
 * card (these are deploy-specific outcomes).
 */
import type { ConnState } from './LogViewerHeader';
import { FailureSummary } from './FailureSummary';
import { SuccessSummary } from './SuccessSummary';
import { CancelledSummary } from './CancelledSummary';

export interface LogViewerSummaryCardsProps {
  variant: 'deploy' | 'runtime';
  connState: ConnState;
  buildOutcome: 'success' | 'fail' | null;
  errorClass: string;
  serviceName: string;
  publicUrl: string | null;
  internalPort: number | null;
  duration: string;
}

export function LogViewerSummaryCards({
  variant,
  connState,
  buildOutcome,
  errorClass,
  serviceName,
  publicUrl,
  internalPort,
  duration,
}: LogViewerSummaryCardsProps) {
  if (variant === 'runtime') return null;

  const wrapperClass = 'border-t border-[oklch(0.32_0.015_255)] bg-[oklch(0.22_0.018_255)] p-3';

  if (connState === 'ENDED' && buildOutcome === 'fail') {
    return (
      <div className={wrapperClass}>
        <FailureSummary errorClass={errorClass} />
      </div>
    );
  }
  if (connState === 'ENDED' && buildOutcome === 'success') {
    return (
      <div className={wrapperClass}>
        <SuccessSummary
          serviceName={serviceName}
          publicUrl={publicUrl}
          internalPort={internalPort}
          duration={duration}
        />
      </div>
    );
  }
  if (connState === 'CANCELLED') {
    return (
      <div className={wrapperClass}>
        <CancelledSummary />
      </div>
    );
  }
  return null;
}
