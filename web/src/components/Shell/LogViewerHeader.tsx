/**
 * LogViewer header chrome — extracted from LogViewer.tsx in PR4-C.
 *
 * Carries:
 *   - HeaderPill: the connection-state pill (Connecting / Live / Failed / etc.)
 *   - FsmBadge: tiny mono-tagged "STATE × VIEW" badge for non-default states
 *   - HeaderActionButton: thin secondary action for Copy / Download / Kill
 *   - Dot: the animated dot used inside HeaderPill
 *
 * The colors are intentionally inline `oklch(...)` literals — the
 * LogViewer is dark-only by design and we hand-pick the dark values
 * rather than route through theme-aware tokens.
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
        className={cn(base, 'border border-[oklch(0.4_0.02_255)] text-[oklch(0.85_0.012_255)]')}
      >
        <Dot color="var(--ol-fg-muted)" />
        Connecting…
      </span>
    );
  }
  if (connState === 'LIVE') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_165)] text-[oklch(0.92_0.04_165)]')}>
        <Dot pulse color="var(--ol-success)" />
        Live · {liveDur}
      </span>
    );
  }
  if (connState === 'RECONNECTING') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_70)] text-[oklch(0.92_0.04_80)]')}>
        <Dot pulse color="var(--ol-warning)" />
        Reconnecting · {liveDur}
      </span>
    );
  }
  if (connState === 'BACKFILLING') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_235)] text-[oklch(0.92_0.04_235)]')}>
        <Dot pulse color="var(--ol-info)" />
        Backfilling…
      </span>
    );
  }
  if (connState === 'ENDED' && buildOutcome === 'fail') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_28)] text-[oklch(0.92_0.04_28)]')}>
        <Dot color="var(--ol-error)" />
        Failed · {liveDur}
      </span>
    );
  }
  if (connState === 'ENDED') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_165)] text-[oklch(0.92_0.04_165)]')}>
        <Dot color="var(--ol-success)" />
        Done · {liveDur}
      </span>
    );
  }
  if (connState === 'ERRORED') {
    return (
      <span className={cn(base, 'bg-[oklch(0.32_0.08_28)] text-[oklch(0.92_0.04_28)]')}>
        <Dot color="var(--ol-error)" />
        Stream error · {liveDur}
      </span>
    );
  }
  if (connState === 'CANCELLED') {
    return (
      <span
        className={cn(base, 'border border-[oklch(0.4_0.02_255)] text-[oklch(0.72_0.012_255)]')}
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
      className="ol-mono inline-flex rounded border border-[oklch(0.4_0.02_255)] px-1.5 py-0.5 text-[10px] text-[oklch(0.72_0.012_255)]"
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
      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] text-[oklch(0.72_0.012_255)] transition-colors hover:bg-[oklch(0.32_0.015_255)] hover:text-[oklch(0.96_0.005_250)]"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
