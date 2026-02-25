import React from 'react';
import { Box, Text } from 'ink';
import { filterCommands, type SlashCommand } from '../commands/registry.js';

interface SlashCommandPickerProps {
  /** Current input text (e.g. "/dep" — must start with /). */
  input: string;
  /** Index of the highlighted command in the filtered list. */
  selectedIndex: number;
}

/**
 * Autocomplete dropdown for slash commands.
 * Shows matching commands as the user types after "/".
 */
export function SlashCommandPicker({
  input,
  selectedIndex,
}: SlashCommandPickerProps): React.ReactElement | null {
  // Extract the partial command name after "/"
  const prefix = input.slice(1).split(' ')[0] ?? '';
  const matches = filterCommands(prefix);

  if (matches.length === 0) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Text dimColor>No matching commands</Text>
      </Box>
    );
  }

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
      {matches.map((cmd: SlashCommand, i: number) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={cmd.name} gap={1}>
            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
              {isSelected ? '▸' : ' '} /{cmd.name}
            </Text>
            <Text dimColor>— {cmd.description}</Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>[↑↓] Select [Tab] Complete [Enter] Run [Esc] Cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Get the list of matching commands for the current input.
 * Useful for the parent component to track selectedIndex bounds.
 */
export function getMatchCount(input: string): number {
  const prefix = input.slice(1).split(' ')[0] ?? '';
  return filterCommands(prefix).length;
}

/**
 * Get the command name at a given index in the filtered list.
 */
export function getMatchAt(input: string, index: number): string | null {
  const prefix = input.slice(1).split(' ')[0] ?? '';
  const matches = filterCommands(prefix);
  return matches[index]?.name ?? null;
}
