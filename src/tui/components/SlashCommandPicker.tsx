import { For, Show } from 'solid-js';
import { filterCommands, type SlashCommand } from '../commands/registry.js';
import { theme } from '../theme.js';

// ---------------------------------------------------------------------------
// Border helpers (matches Prompt's SplitBorder style)
// ---------------------------------------------------------------------------

const EmptyBorder = {
  topLeft: ' ',
  topRight: ' ',
  bottomLeft: ' ',
  bottomRight: ' ',
  horizontal: ' ',
  vertical: ' ',
  topT: ' ',
  bottomT: ' ',
  leftT: ' ',
  rightT: ' ',
  cross: ' ',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlashCommandPickerProps {
  /** Current input text (e.g. "/dep" — must start with /). */
  input: string;
  /** Index of the highlighted command in the filtered list. */
  selectedIndex: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * OpenCode-style autocomplete dropdown for slash commands.
 * Renders above the prompt with a left pipe border, themed background,
 * and highlighted selection row.
 */
export function SlashCommandPicker(props: SlashCommandPickerProps) {
  const prefix = () => props.input.slice(1).split(' ')[0] ?? '';
  const matches = () => filterCommands(prefix());

  return (
    <Show
      when={matches().length > 0}
      fallback={
        <box
          paddingLeft={1}
          paddingRight={1}
          border={['left']}
          borderColor={theme.border}
          customBorderChars={{ ...EmptyBorder, vertical: '┃' }}
          backgroundColor={theme.backgroundMenu}
        >
          <text fg={theme.textMuted}>No matching commands</text>
        </box>
      }
    >
      <box
        border={['left']}
        borderColor={theme.border}
        customBorderChars={{ ...EmptyBorder, vertical: '┃' }}
        backgroundColor={theme.backgroundMenu}
      >
        <For each={matches()}>
          {(cmd: SlashCommand, i) => {
            const isSelected = () => i() === props.selectedIndex;
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isSelected() ? theme.primary : undefined}
                flexDirection="row"
                gap={1}
              >
                <text
                  fg={isSelected() ? theme.text : theme.text}
                  bold={isSelected()}
                  flexShrink={0}
                >
                  /{cmd.name}
                </text>
                <text fg={isSelected() ? theme.text : theme.textMuted} wrapMode="none">
                  {cmd.description}
                </text>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}

// ---------------------------------------------------------------------------
// Helpers (exported for parent component)
// ---------------------------------------------------------------------------

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
