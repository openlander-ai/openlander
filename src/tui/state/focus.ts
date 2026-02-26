/**
 * Panel focus state management.
 *
 * Controls which panel receives keyboard input:
 * - chat:   Left panel (text input, slash commands)
 * - status: Right panel (project navigation, Enter for debug mode)
 */
import { createSignal } from 'solid-js';

export type PanelFocus = 'chat' | 'status';

const [focus, setFocus] = createSignal<PanelFocus>('chat');

/** Toggle focus between chat and status panels. */
export function toggleFocus(): void {
  setFocus((prev) => (prev === 'chat' ? 'status' : 'chat'));
}

/** Explicitly focus the chat panel. */
export function focusChat(): void {
  setFocus('chat');
}

/** Explicitly focus the status panel. */
export function focusStatus(): void {
  setFocus('status');
}

export { focus };
