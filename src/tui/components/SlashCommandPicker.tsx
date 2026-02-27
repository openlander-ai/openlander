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
  /** Called when a command is clicked with the mouse. */
  onSelect?: (commandName: string) => void;
  /** Called when a command is hovered with the mouse. */
  onHover?: (index: number) => void;
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
                onMouseDown={(e: unknown) => {
                  const me = e as { button?: number; stopPropagation?: () => void };
                  if (me.button === 0) {
                    me.stopPropagation?.();
                    props.onSelect?.(cmd.name);
                  }
                }}
                onMouseOver={() => {
                  props.onHover?.(i());
                }}
              >
                <text
                  fg={isSelected() ? theme.background : theme.text}
                  bold={isSelected()}
                  flexShrink={0}
                >
                  /{cmd.name}
                </text>
                <text fg={isSelected() ? theme.background : theme.textMuted} wrapMode="none">
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
// Helpers (re-exported for parent component)
// ---------------------------------------------------------------------------

export { getMatchCount, getMatchAt } from '../commands/match-utils.js';
