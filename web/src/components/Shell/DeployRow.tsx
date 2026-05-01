/**
 * Deploy row + trigger chip + status pill — shared v4 components.
 *
 * Extracted from ServiceDetailV2 so the global Deployments page
 * (cross-project audit view) can render the exact same row shape v4
 * specifies (`/tmp/ol-design-v4-backup/test/project/src/service.jsx`
 * lines 63-86, 73). The optional `projectName` slot is the only
 * difference vs the per-service render — global view shows which
 * project owns the deploy; per-service view omits it.
 */
import { Eye, MoreHorizontal } from 'lucide-react';
import type { DeployLogSummary } from '@/types/index';
import { cn } from '@/lib/utils';

export interface DeployRowProps {
  d: DeployLogSummary;
  onView: () => void;
  /** Optional project label rendered before the commit sha (cross-project audit view). */
  projectName?: string;
}

export function DeployRow({ d, onView, projectName }: DeployRowProps) {
  const durationSec = d.durationMs != null ? Math.round(d.durationMs / 1000) : null;
  const durationLabel =
    durationSec != null
      ? durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : `${durationSec}s`
      : null;
  const startedLabel = d.createdAt
    ? new Date(d.createdAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          d.status === 'success' && 'bg-[color:var(--ol-success)]',
          d.status === 'failed' && 'bg-[color:var(--ol-error)]',
          d.status === 'cancelled' && 'bg-[color:var(--ol-fg-subtle)]',
          // `running` isn't in DeployLogSummary['status'] today (the
          // backend only persists terminal states) — keep the branch
          // commented as a placeholder for when running rows surface.
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          {projectName && (
            <span className="text-[12.5px] font-medium text-[color:var(--ol-fg)]">
              {projectName}
            </span>
          )}
          <span className="ol-mono text-[11.5px] text-[color:var(--ol-fg-muted)]">
            {d.commitSha ? d.commitSha.slice(0, 7) : d.id.slice(0, 8)}
          </span>
          {d.commitMessage && (
            <span className="truncate text-[12.5px] text-[color:var(--ol-fg-muted)]">
              {d.commitMessage}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--ol-fg-subtle)]">
          <TriggerChip trigger={d.trigger} />
          {durationLabel && <span>{durationLabel}</span>}
          <span>{startedLabel}</span>
          {d.failureSummary && (
            <span className="ol-mono text-[color:var(--ol-error)]">{d.failureSummary}</span>
          )}
        </div>
      </div>
      <StatusPill status={d.status} />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onView}
          className="inline-flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <Eye className="h-3 w-3" />
          View
        </button>
        <button
          type="button"
          aria-label="More actions"
          className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function TriggerChip({ trigger }: { trigger: DeployLogSummary['trigger'] }) {
  const tone =
    trigger === 'api'
      ? 'text-[color:var(--ol-actor-mcp)] bg-[color-mix(in_oklch,var(--ol-actor-mcp)_14%,transparent)]'
      : trigger === 'webhook'
        ? 'text-[color:var(--ol-actor-webhook)] bg-[color-mix(in_oklch,var(--ol-actor-webhook)_14%,transparent)]'
        : 'text-[color:var(--ol-fg-muted)] bg-[color:var(--ol-panel-2)]';
  const label = trigger === 'api' ? 'mcp/api' : trigger === 'webhook' ? 'git push' : 'manual';
  return (
    <span
      className={cn(
        'ol-mono inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function StatusPill({
  status,
}: {
  status: DeployLogSummary['status'] | 'running' | 'building';
}) {
  type StatusKey = typeof status;
  const map: Partial<Record<StatusKey, { label: string; tone: string }>> = {
    running: {
      label: 'Running',
      tone: 'bg-[color:var(--ol-info-soft)] text-[color:var(--ol-info)]',
    },
    building: {
      label: 'Building',
      tone: 'bg-[color:var(--ol-info-soft)] text-[color:var(--ol-info)]',
    },
    success: {
      label: 'Done',
      tone: 'bg-[color:var(--ol-success-soft)] text-[color:var(--ol-success)]',
    },
    failed: {
      label: 'Failed',
      tone: 'bg-[color:var(--ol-error-soft)] text-[color:var(--ol-error)]',
    },
    cancelled: {
      label: 'Cancelled',
      tone: 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
    },
  };
  const v = map[status] ?? {
    label: status,
    tone: 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium',
        v.tone,
      )}
    >
      {v.label}
    </span>
  );
}
