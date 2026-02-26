/**
 * Type declarations for @opentui/solid runtime APIs.
 *
 * These hooks exist at runtime but the package does not ship .d.ts files.
 */

declare module '@opentui/solid' {
  import type { Accessor } from 'solid-js';

  export interface KeyboardEvent {
    key: string;
    char: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    alt: boolean;
  }

  export function useKeyboard(handler: (evt: KeyboardEvent) => void): void;

  export function useTerminalDimensions(): Accessor<{
    width: number;
    height: number;
  }>;

  export function render(element: () => unknown): void;
}
