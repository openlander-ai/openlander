/**
 * Animated dots spinner for OpenTUI.
 *
 * Uses a SINGLE shared global timer for ALL spinner instances.
 * Previous implementation created a separate 80ms setInterval per instance,
 * causing 40-60+ re-renders/sec when multiple spinners were active simultaneously.
 * Now all spinners read from one shared signal → one timer, one update, N reads.
 */
import { createSignal, onCleanup, type ParentProps } from 'solid-js';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ── Shared global animation state ──────────────────────────────────────────
// One timer drives ALL spinners. Reference-counted so the timer only runs
// while at least one Spinner is mounted.

const [globalFrame, setGlobalFrame] = createSignal(0);
let globalTimer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

function acquireSpinner(): void {
  refCount++;
  if (refCount === 1 && !globalTimer) {
    globalTimer = setInterval(() => {
      setGlobalFrame((f) => (f + 1) % DOTS.length);
    }, 120); // 120ms (~8fps) is plenty smooth for a dots spinner
  }
}

function releaseSpinner(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && globalTimer) {
    clearInterval(globalTimer);
    globalTimer = null;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export interface SpinnerProps extends ParentProps {
  color?: string;
}

export function Spinner(props: SpinnerProps) {
  acquireSpinner();
  onCleanup(releaseSpinner);

  return <span style={{ fg: props.color }}>{DOTS[globalFrame()]}</span>;
}
