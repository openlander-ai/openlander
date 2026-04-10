import { useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Shortcut {
  key: string; // 'j', 'k', '/', 'Escape', '?'
  handler: () => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useKeyboardShortcuts
 *
 * Registers keyboard shortcuts with automatic disabling when focus is on
 * input, textarea, select, or contenteditable elements.
 *
 * @param shortcuts - Array of shortcut definitions
 *
 * @example
 * useKeyboardShortcuts([
 *   { key: 'j', handler: () => console.log('next') },
 *   { key: 'k', handler: () => console.log('prev') },
 *   { key: '/', handler: () => console.log('search') },
 *   { key: 'Escape', handler: () => console.log('close') },
 *   { key: '?', handler: () => console.log('help') },
 * ]);
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if focus is on an input-like element
      const target = event.target as HTMLElement;
      const isInputLike =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.contentEditable === 'true');

      // Skip shortcuts if focused on input-like element
      if (isInputLike) {
        return;
      }

      // Find matching shortcut
      const shortcut = shortcuts.find((s) => s.key === event.key && !s.disabled);

      if (shortcut) {
        event.preventDefault();
        shortcut.handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts]);
}
