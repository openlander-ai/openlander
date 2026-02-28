/**
 * Type declarations for @opentui/solid runtime APIs.
 *
 * These hooks exist at runtime but the package does not ship .d.ts files.
 */

declare module '@opentui/solid' {
  import type { Accessor } from 'solid-js';

  export interface KeyboardEvent {
    /** Key name (e.g. 'enter', 'escape', 'up', 'down', 'a', 'b') */
    name: string;
    /** Raw character if printable */
    char: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    alt: boolean;
    /** Stop propagation to subsequent key handlers */
    stopPropagation?: () => void;
  }

  export interface MouseEvent {
    /** Event type: 'down', 'up', 'move', 'scroll', 'over', 'out', 'drag', 'drag-end', 'drop' */
    type: string;
    /** Mouse button: 0 = left, 1 = middle, 2 = right */
    button: number;
    /** Terminal column */
    x: number;
    /** Terminal row */
    y: number;
    /** Modifier keys */
    modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
    /** Stop propagation to parent elements */
    stopPropagation(): void;
  }

  export function useKeyboard(handler: (evt: KeyboardEvent) => void): void;

  export function useTerminalDimensions(): Accessor<{
    width: number;
    height: number;
  }>

  export interface Selection {
    readonly isActive: boolean;
    readonly isDragging: boolean;
    readonly anchor: { x: number; y: number };
    readonly focus: { x: number; y: number };
    getSelectedText(): string;
  }

  export interface CliRenderer {
    copyToClipboardOSC52(text: string, target?: number): boolean;
  }

  export function useSelectionHandler(callback: (selection: Selection) => void): void;

  export function useRenderer(): CliRenderer;

  export function render(element: () => unknown, config?: Record<string, unknown>): void;
}
