import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

interface StatusBarProps {
  panelMode: 'split' | 'single';
  activePanel: 'left' | 'right';
  projectCount: number;
  cpuPercent: number | null;
  buildingCount: number;
}

/**
 * Bottom status bar with keyboard shortcut hints.
 *
 * - Split mode: Shows standard shortcuts
 * - Single mode: Shows panel switch hint + summary stats
 */
export function StatusBar({
  panelMode,
  activePanel,
  projectCount,
  cpuPercent,
  buildingCount,
}: StatusBarProps): React.ReactElement {
  const isSplitMode = panelMode === 'split';

  // Format CPU display
  const cpuDisplay = cpuPercent !== null ? `${String(cpuPercent)}%` : '—';

  // Format building indicator
  const buildingDisplay = buildingCount > 0 ? ` | ${String(buildingCount)} building` : '';

  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left side: Keyboard hints */}
      <Box gap={1}>
        {isSplitMode ? (
          // Split mode shortcuts
          <>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                Tab{' '}
              </Text>
              <Text dimColor> Panel</Text>
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                /{' '}
              </Text>
              <Text dimColor> Commands</Text>
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ?{' '}
              </Text>
              <Text dimColor> Help</Text>
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ^C{' '}
              </Text>
              <Text dimColor> Exit</Text>
            </Box>
          </>
        ) : (
          // Single mode shortcuts with panel indicator
          <>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                Tab{' '}
              </Text>
              <Text> </Text>
              {activePanel === 'left' ? (
                <>
                  <Text backgroundColor={theme.secondary} color="#212121" bold>
                    {' '}
                    Chat{' '}
                  </Text>
                  <Text dimColor> │ </Text>
                  <Text dimColor>Dashboard</Text>
                </>
              ) : (
                <>
                  <Text dimColor>Chat</Text>
                  <Text dimColor> │ </Text>
                  <Text backgroundColor={theme.secondary} color="#212121" bold>
                    {' '}
                    Dashboard{' '}
                  </Text>
                </>
              )}
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                /{' '}
              </Text>
              <Text dimColor> Commands</Text>
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ?{' '}
              </Text>
              <Text dimColor> Help</Text>
            </Box>
            <Box>
              <Text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ^C{' '}
              </Text>
              <Text dimColor> Exit</Text>
            </Box>
          </>
        )}
      </Box>

      {/* Right side: Summary (only in single mode) */}
      {!isSplitMode && (
        <Box>
          <Text color={theme.muted}>
            {projectCount} project{projectCount !== 1 ? 's' : ''} │ CPU {cpuDisplay}
            {buildingDisplay}
          </Text>
        </Box>
      )}
    </Box>
  );
}
