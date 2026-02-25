import React from 'react';
import { Box, useStdout } from 'ink';

interface LayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  statusBar: React.ReactNode;
  overlay?: React.ReactNode;
  activePanel?: 'left' | 'right';
}

/**
 * Split-panel layout with responsive behavior.
 *
 * - columns >= 100: 55/45 split with left and right panels side by side
 * - columns < 100: single panel mode, controlled by activePanel prop
 */
export function Layout({
  left,
  right,
  statusBar,
  overlay,
  activePanel = 'left',
}: LayoutProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout.columns;
  const rows = stdout.rows;

  const isWideMode = columns >= 100;

  // Calculate panel widths in wide mode
  const leftWidth = isWideMode ? Math.floor(columns * 0.55) : '100%';
  const rightWidth = isWideMode ? Math.floor(columns * 0.45) : '100%';

  // Reserve 1 row for status bar
  const contentHeight = rows - 1;

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {/* Main content area */}
      <Box flexDirection="row" flexGrow={1} height={contentHeight} overflow="hidden">
        {isWideMode ? (
          // Wide mode: both panels side by side
          <>
            {/* Left panel - has right border as divider */}
            <Box
              width={leftWidth}
              flexDirection="column"
              borderStyle="single"
              borderRight
              borderLeft={false}
              borderTop={false}
              borderBottom={false}
              overflow="hidden"
            >
              {left}
            </Box>

            {/* Right panel - no borders */}
            <Box width={rightWidth} flexDirection="column" overflow="hidden">
              {right}
            </Box>
          </>
        ) : (
          // Narrow mode: single panel at a time
          <Box width="100%" flexDirection="column" overflow="hidden">
            {activePanel === 'left' ? left : right}
          </Box>
        )}
      </Box>

      {/* Status bar at bottom */}
      {statusBar}

      {/* Overlay on top of everything */}
      {overlay && (
        <Box
          position="absolute"
          width={columns}
          height={rows}
          flexDirection="column"
        >
          {overlay}
        </Box>
      )}
    </Box>
  );
}
