import { filterCommands } from './registry.js';

/**
 * Get the count of matching commands for the current input.
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
