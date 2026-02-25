import React from 'react';
import { Box, Text } from 'ink';

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
export function ProgressBar({ percent, width = 20, label }: ProgressBarProps): React.ReactElement {
  // Clamp percent to 0-100 range
  const clampedPercent = Math.max(0, Math.min(100, percent));

  // Calculate filled/empty portions
  const filledCount = Math.round((clampedPercent / 100) * width);
  const emptyCount = width - filledCount;

  const filled = FILLED_CHAR.repeat(filledCount);
  const empty = EMPTY_CHAR.repeat(emptyCount);

  // Color: green when complete, yellow during progress
  const isComplete = clampedPercent >= 100;
  const barColor = isComplete ? 'green' : 'yellow';
  const percentColor = isComplete ? 'green' : 'yellow';

  return (
    <Box gap={1}>
      {label && <Text dimColor>{label}</Text>}
      <Text color={barColor}>{filled}</Text>
      <Text dimColor>{empty}</Text>
      <Text color={percentColor}>{`${String(clampedPercent)}%`}</Text>
    </Box>
  );
}
