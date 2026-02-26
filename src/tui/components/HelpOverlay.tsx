import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
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

export function HelpOverlay(props: HelpOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    if (evt.name === 'escape') {
      props.onClose();
    }
    // Prevent background components from receiving this event
    evt.stopPropagation?.();
  });

  const contentWidth = 50;

  return (
    <box
      flexDirection="column"
      width={columns()}
      height={rows()}
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme.background}
    >
      <box
        flexDirection="column"
        border="round"
        borderColor={theme.borderActive}
        paddingX={2}
        paddingY={1}
        width={contentWidth}
        backgroundColor={theme.backgroundMenu}
      >
        {/* Header */}
        <box marginBottom={1} justifyContent="center">
          <text bold={true} fg={theme.text}>
            Keyboard Shortcuts
          </text>
        </box>

        {/* Shortcuts table */}
        <box flexDirection="column" gap={0}>
          <For each={SHORTCUTS}>
            {(shortcut) => (
              <box gap={2}>
                <box width={12}>
                  <text backgroundColor={theme.backgroundElement} fg={theme.warning}>
                    {' '}
                    {shortcut.key}{' '}
                  </text>
                </box>
                <text fg={theme.textMuted}>{shortcut.description}</text>
              </box>
            )}
          </For>
        </box>

        {/* Footer hint */}
        <box marginTop={1} justifyContent="center">
          <text fg={theme.textDim}>[Esc] Close</text>
        </box>
      </box>
    </box>
  );
}
