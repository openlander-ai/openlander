import type { JSX } from 'solid-js';
import { Show, For } from 'solid-js';
import { useKeyboard } from '@opentui/solid';

export interface PatchNotesProps {
  version: string;
  onDismiss?: () => void;
}

/**
 * PatchNotes component - shows what's new in a given version.
 * Used in Ready.tsx and for version-update splash screens.
 */
export function PatchNotes({ version, onDismiss }: PatchNotesProps): JSX.Element {
  useKeyboard((evt) => {
    if (evt.key === 'return' && onDismiss) {
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
    <box flexDirection="column" alignItems="center">
      <box marginBottom={1}>
        <text bold={true} color="cyan">
          📋 What&apos;s new in v{version}
        </text>
      </box>

      <box flexDirection="column" marginLeft={2}>
        <For each={notes}>
          {(note) => (
            <box>
              <text dim={true}>• </text>
              <text>{note}</text>
            </box>
          )}
        </For>
      </box>

      <Show when={onDismiss}>
        <box marginTop={1}>
          <text dim={true}>[Enter] Continue</text>
        </box>
      </Show>
    </box>
  );
}
