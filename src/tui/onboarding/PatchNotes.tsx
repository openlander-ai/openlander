import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface PatchNotesProps {
  version: string;
  onDismiss?: () => void;
}

/**
 * PatchNotes component - shows what's new in a given version.
 * Used in Ready.tsx and for version-update splash screens.
 */
export function PatchNotes({ version, onDismiss }: PatchNotesProps): React.ReactElement {
  useInput((_input, key) => {
    if (key.return && onDismiss) {
      onDismiss();
    }
  });

  // Hardcoded notes for v0.1.0
  const notes = [
    'TUI: Chat + live dashboard',
    'MCP: Claude Code & Cursor integration',
    'Quick Share via TryCloudflare',
    'Slash commands for power users',
  ];

  return (
    <Box flexDirection="column" alignItems="center">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          📋 What&apos;s new in v{version}
        </Text>
      </Box>

      <Box flexDirection="column" marginLeft={2}>
        {notes.map((note, index) => (
          <Box key={index}>
            <Text dimColor>• </Text>
            <Text>{note}</Text>
          </Box>
        ))}
      </Box>

      {onDismiss && (
        <Box marginTop={1}>
          <Text dimColor>[Enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}
