/**
 * PhaseRail — top progression bar for the LogViewer.
 *
 * Six phases, color-coded by status:
 *   pending → muted
 *   active  → primary (with subtle pulse)
 *   done    → success + check
 *   failed  → error + X
 *   skipped → muted with dashed border + dash glyph; used for cached
 *             pulls, missing HEALTHCHECK, or any silent phase on a
 *             successful pipeline so a green "done" never lies about
 *             a step that did not actually run.
 */
import { Check, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PhaseStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export const PHASE_DEFS = [
  { id: 'clone', label: 'Clone' },
  { id: 'image_pull', label: 'Pull' },
  { id: 'build', label: 'Build' },
  { id: 'container_create', label: 'Create' },
  { id: 'container_start', label: 'Start' },
  { id: 'healthcheck_wait', label: 'Health' },
] as const;

export type PhaseId = (typeof PHASE_DEFS)[number]['id'];

export interface PhaseRailProps {
  status: Record<PhaseId, PhaseStatus>;
}

export function PhaseRail({ status }: PhaseRailProps) {
  return (
    <div
      role="status"
      aria-label="Deploy phase progression"
      className="flex flex-wrap items-center gap-2 border-b border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-2.5"
    >
      {PHASE_DEFS.map((p, i) => {
        const st = status[p.id] ?? 'pending';
        return (
          <div key={p.id} className="flex items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                →
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors',
                st === 'pending' &&
                  'border border-[color:var(--ol-border-subtle)] text-[color:var(--ol-fg-subtle)]',
                st === 'active' &&
                  'border border-[color:var(--ol-primary)] bg-[color:var(--ol-primary-soft)] font-medium text-[color:var(--ol-primary)]',
                st === 'done' &&
                  'border border-[color:var(--ol-success)] bg-[color:var(--ol-success-soft)] text-[color:var(--ol-success)]',
                st === 'failed' &&
                  'border border-[color:var(--ol-error)] bg-[color:var(--ol-error-soft)] font-medium text-[color:var(--ol-error)]',
                st === 'skipped' &&
                  'border border-dashed border-[color:var(--ol-border-subtle)] text-[color:var(--ol-fg-subtle)]',
              )}
              title={st === 'skipped' ? 'Skipped (cached or not needed)' : undefined}
            >
              {st === 'done' && <Check aria-hidden className="h-3 w-3" />}
              {st === 'failed' && <X aria-hidden className="h-3 w-3" />}
              {st === 'skipped' && <Minus aria-hidden className="h-3 w-3" />}
              {st === 'active' && (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: 'var(--ol-primary)' }}
                />
              )}
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default PhaseRail;
