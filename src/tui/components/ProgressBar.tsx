import type { JSX } from 'solid-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  /** Progress percentage (0-100) */
  percent: number;
  /** Character width of the bar (default 20) */
  width?: number;
  /** Optional label shown before the bar */
  label?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Visual progress bar for build/deploy operations.
 *
 * Renders: `████████████░░░░░░ 67%`
 * - Green when complete (100%)
 * - Yellow during progress
 */
export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const width = () => props.width ?? 20;
  const percent = () => Math.max(0, Math.min(100, props.percent));

  // Calculate filled/empty portions
  const filledCount = () => Math.round((percent() / 100) * width());
  const emptyCount = () => width() - filledCount();

  const filled = () => FILLED_CHAR.repeat(filledCount());
  const empty = () => EMPTY_CHAR.repeat(emptyCount());

  // Color: green when complete, yellow during progress
  const isComplete = () => percent() >= 100;
  const barColor = () => (isComplete() ? 'green' : 'yellow');
  const percentColor = () => (isComplete() ? 'green' : 'yellow');

  return (
    <box gap={1}>
      {props.label && <text dim>{props.label}</text>}
      <text color={barColor()}>{filled()}</text>
      <text dim>{empty()}</text>
      <text color={percentColor()}>{`${String(percent())}%`}</text>
    </box>
  );
}
