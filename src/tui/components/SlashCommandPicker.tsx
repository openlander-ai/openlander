import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { filterCommands, type SlashCommand } from '../commands/registry.js';
import { theme } from '../theme.js';

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
export function SlashCommandPicker(props: SlashCommandPickerProps): JSX.Element | null {
  // Extract the partial command name after "/"
  const prefix = () => props.input.slice(1).split(' ')[0] ?? '';
  const matches = () => filterCommands(prefix());

  return (
    <Show
      when={matches().length > 0}
      fallback={
        <box border="single" borderColor="gray" paddingX={1} flexDirection="column">
          <text dim>No matching commands</text>
        </box>
      }
    >
      <box border="single" borderColor="cyan" paddingX={1} flexDirection="column">
        <For each={matches()}>
          {(cmd: SlashCommand, i) => {
            const isSelected = () => i() === props.selectedIndex;
            return (
              <box gap={1}>
                <text color={isSelected() ? 'cyan' : 'white'} bold={isSelected()}>
                  {isSelected() ? '▸' : ' '} /{cmd.name}
                </text>
                <text dim>— {cmd.description}</text>
              </box>
            );
          }}
        </For>
        <box marginTop={1}>
          <text dim>[↑↓] Select [Tab] Complete [Enter] Run [Esc] Cancel</text>
        </box>
      </box>
    </Show>
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
