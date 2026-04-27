/**
 * LogViewer header chrome — extracted from LogViewer.tsx in PR4-C.
 *
 * Phase D token swap: hardcoded oklch literals replaced with var(--log-header-*)
 * tokens that are defined in LogViewer.css's .ol-log-pane scope.
 *
 * Carries:
 *   - HeaderPill: the connection-state pill (Connecting / Live / Failed / etc.)
 *   - FsmBadge: tiny mono-tagged "STATE × VIEW" badge for non-default states
 *   - HeaderActionButton: thin secondary action for Copy / Download / Kill
 *   - Dot: the animated dot used inside HeaderPill
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ConnState =
  | 'IDLE'
  | 'CONNECTING'
  | 'LIVE'
  | 'RECONNECTING'
  | 'BACKFILLING'
  | 'ENDED'
  | 'ERRORED'
  | 'CANCELLED';

export type ViewState = 'FOLLOWING' | 'PAUSED';

interface DotProps {
  color: string;
  pulse?: boolean;
}

export function Dot({ color, pulse = false }: DotProps) {
  return (
    <span
      aria-hidden
      className={cn('h-1.5 w-1.5 rounded-full', pulse && 'animate-pulse')}
      style={{ backgroundColor: color }}
    />
  );
}

export interface HeaderPillProps {
  connState: ConnState;
  buildOutcome: 'success' | 'fail' | null;
  liveDur: string;
}

export function HeaderPill({ connState, buildOutcome, liveDur }: HeaderPillProps) {
  const base =
    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none';
  if (connState === 'CONNECTING') {
    return (
      <span
        className={cn(
          base,
          'border border-[color:var(--log-header-border)] text-[color:var(--log-header-muted)]',
        )}
      >
        <Dot color="var(--ol-fg-muted)" />
        Connecting…
      </span>
    );
  }
  if (connState === 'LIVE') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-success)_18%,var(--log-header-bg))] text-[color:var(--log-success)]',
        )}
      >
        <Dot pulse color="var(--ol-success)" />
        Live · {liveDur}
      </span>
    );
  }
  if (connState === 'RECONNECTING') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-warning)_18%,var(--log-header-bg))] text-[color:var(--log-warning)]',
        )}
      >
        <Dot pulse color="var(--ol-warning)" />
        Reconnecting · {liveDur}
      </span>
    );
  }
  if (connState === 'BACKFILLING') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-cyan)_18%,var(--log-header-bg))] text-[color:var(--log-cyan)]',
        )}
      >
        <Dot pulse color="var(--ol-info)" />
        Backfilling…
      </span>
    );
  }
  if (connState === 'ENDED' && buildOutcome === 'fail') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-error)_18%,var(--log-header-bg))] text-[color:var(--log-error)]',
        )}
      >
        <Dot color="var(--ol-error)" />
        Failed · {liveDur}
      </span>
    );
  }
  if (connState === 'ENDED') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-success)_18%,var(--log-header-bg))] text-[color:var(--log-success)]',
        )}
      >
        <Dot color="var(--ol-success)" />
        Done · {liveDur}
      </span>
    );
  }
  if (connState === 'ERRORED') {
    return (
      <span
        className={cn(
          base,
          'bg-[color-mix(in_oklch,var(--log-error)_18%,var(--log-header-bg))] text-[color:var(--log-error)]',
        )}
      >
        <Dot color="var(--ol-error)" />
        Stream error · {liveDur}
      </span>
    );
  }
  if (connState === 'CANCELLED') {
    return (
      <span
        className={cn(
          base,
          'border border-[color:var(--log-header-border)] text-[color:var(--log-header-muted)]',
        )}
      >
        <Dot color="var(--ol-fg-muted)" />
        Cancelled · {liveDur}
      </span>
    );
  }
  return null;
}

export function FsmBadge({ connState, viewState }: { connState: ConnState; viewState: ViewState }) {
  const isDefault =
    (connState === 'LIVE' || connState === 'ENDED' || connState === 'CANCELLED') &&
    viewState === 'FOLLOWING';
  if (isDefault) return null;
  return (
    <span
      className="ol-mono inline-flex rounded border border-[color:var(--log-header-border)] px-1.5 py-0.5 text-[10px] text-[color:var(--log-header-muted)]"
      title="Connection × Viewport state"
    >
      {connState} · {viewState}
    </span>
  );
}

export interface HeaderActionButtonProps {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onClick?: () => void;
}

export function HeaderActionButton({ icon, title, children, onClick }: HeaderActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] text-[color:var(--log-header-muted)] transition-colors hover:bg-[color:var(--log-header-border)] hover:text-[color:var(--log-header-text)]"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
