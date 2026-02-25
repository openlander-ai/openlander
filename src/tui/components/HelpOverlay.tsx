import React from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { theme } from '../theme.js';

interface HelpOverlayProps {
  onClose: () => void;
}

interface ShortcutRow {
  key: string;
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { key: 'Tab', description: 'Panel focus switch' },
  { key: 'Enter', description: 'Send chat message' },
  { key: '↑ / ↓', description: 'Chat history / Project selection' },
  { key: '/', description: 'Slash command mode' },
  { key: 'Ctrl+L', description: 'Clear chat' },
  { key: 'Ctrl+C', description: 'Cancel / Exit' },
  { key: 'q', description: 'Quit (when not in chat input)' },
  { key: '?', description: 'Help overlay' },
  { key: 'Esc', description: 'Close overlay' },
];

/**
 * Full-screen help overlay showing keyboard shortcuts.
 * Listens for Escape key to close.
 */
export function HelpOverlay({ onClose }: HelpOverlayProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout.columns;
  const rows = stdout.rows;

  // Listen for Escape key to close
  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  // Content dimensions for overlay sizing
  const contentWidth = 50;

  return (
    <Box
      flexDirection="column"
      width={columns}
      height={rows}
      justifyContent="center"
      alignItems="center"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        paddingY={1}
        width={contentWidth}
      >
        {/* Header */}
        <Box marginBottom={1} justifyContent="center">
          <Text bold color={theme.sectionTitle}>
            Keyboard Shortcuts
          </Text>
        </Box>

        {/* Shortcuts table */}
        <Box flexDirection="column" gap={0}>
          {SHORTCUTS.map((shortcut, index) => (
            <Box key={index} gap={2}>
              <Box width={12}>
                <Text color={theme.warning}>{shortcut.key}</Text>
              </Box>
              <Text dimColor>{shortcut.description}</Text>
            </Box>
          ))}
        </Box>

        {/* Footer hint */}
        <Box marginTop={1} justifyContent="center">
          <Text dimColor>[Esc] Close</Text>
        </Box>
      </Box>
    </Box>
  );
}
