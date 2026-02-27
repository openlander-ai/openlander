import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { theme } from '../theme.js';
import { OverlayContainer } from './OverlayContainer.js';

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
  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    if (evt.name === 'escape') {
      props.onClose();
    }
    // Prevent background components from receiving this event
    evt.stopPropagation?.();
  });

  return (
    <OverlayContainer title="Keyboard Shortcuts" footer="[Esc] Close">
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
    </OverlayContainer>
  );
}
