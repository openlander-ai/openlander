/**
 * ScrollableLog — shared auto-scrolling log viewer component.
 *
 * Used by BuildPanel (deploy mode) and LogViewer (debug mode).
 *
 * Features:
 * - Auto-scroll: follows latest log lines by default
 * - Manual mode: ↑↓ pauses auto-scroll for browsing
 * - Resume: `f` or `End` key re-enables auto-scroll
 * - Status indicator: [AUTO-SCROLL] or [PAUSED — press f to follow]
 */
import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { overlayActive } from '../state/overlay.js';
import { theme } from '../theme.js';

export interface LogLine {
  /** Unique key for this log line */
  id: string;
  /** Log text content */
  text: string;
  /** Optional color override for this line */
  color?: string;
  /** Timestamp string (optional, displayed if present) */
  timestamp?: string;
  /** Stream type for coloring (stderr = error color) */
  stream?: 'stdout' | 'stderr';
}

interface ScrollableLogProps {
  /** Log lines to display */
  lines: LogLine[];
  /** Available height in rows */
  height: number;
  /** Whether this component should handle keyboard input */
  focus: boolean;
  /** Optional title shown at the top */
  title?: string;
  /** Optional status text shown in the header area */
  statusText?: string;
}

export function ScrollableLog(props: ScrollableLogProps): JSX.Element {
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [scrollOffset, setScrollOffset] = createSignal(0);

  // Available lines for content (subtract header line + status indicator line)
  const contentHeight = () => Math.max(1, props.height - 2);

  // When new lines arrive and auto-scroll is on, snap to bottom
  createEffect(() => {
    const totalLines = props.lines.length;
    if (autoScroll() && totalLines > 0) {
      const maxOffset = Math.max(0, totalLines - contentHeight());
      setScrollOffset(maxOffset);
    }
  });

  // Visible lines based on scroll offset
  const visibleLines = () => {
    const start = scrollOffset();
    const end = start + contentHeight();
    return props.lines.slice(start, end);
  };

  // Keyboard handling
  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (overlayActive() || !props.focus) return;

    const totalLines = props.lines.length;
    const maxOffset = Math.max(0, totalLines - contentHeight());

    if (evt.name === 'up' || evt.name === 'k') {
      // Scroll up — pause auto-scroll
      setAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }

    if (evt.name === 'down' || evt.name === 'j') {
      // Scroll down — pause auto-scroll
      setAutoScroll(false);
      setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
      return;
    }

    if (evt.name === 'pageup') {
      setAutoScroll(false);
      setScrollOffset((prev) => Math.max(0, prev - contentHeight()));
      return;
    }

    if (evt.name === 'pagedown') {
      setAutoScroll(false);
      setScrollOffset((prev) => Math.min(maxOffset, prev + contentHeight()));
      return;
    }

    if (evt.name === 'f' || evt.name === 'end') {
      // Resume auto-scroll
      setAutoScroll(true);
      setScrollOffset(maxOffset);
      return;
    }

    if (evt.name === 'home') {
      // Jump to top
      setAutoScroll(false);
      setScrollOffset(0);
      return;
    }
  });

  // Cleanup: nothing persistent to clean up, but good practice
  onCleanup(() => {
    // No-op
  });

  const getLineColor = (line: LogLine): string => {
    if (line.color) return line.color;
    if (line.stream === 'stderr') return theme.error;
    return theme.textMuted;
  };

  return (
    <box flexDirection="column" height={props.height} overflow="hidden">
      {/* Header with title and scroll status */}
      <box flexDirection="row" gap={1}>
        <Show when={props.title}>
          <text bold={true} fg={theme.text}>
            {props.title}
          </text>
        </Show>
        <Show when={props.statusText}>
          <text fg={theme.textDim}>{props.statusText}</text>
        </Show>
        <box flexGrow={1} />
        {autoScroll() ? (
          <text fg={theme.success}>[AUTO-SCROLL]</text>
        ) : (
          <text fg={theme.warning}>[PAUSED — press f to follow]</text>
        )}
      </box>

      {/* Log content */}
      <box flexDirection="column" flexGrow={1} overflow="hidden">
        <Show
          when={props.lines.length > 0}
          fallback={
            <text fg={theme.textDim} paddingLeft={1}>
              Waiting for log output...
            </text>
          }
        >
          <For each={visibleLines()}>
            {(line) => (
              <box>
                <Show when={line.timestamp}>
                  <text fg={theme.textDim}>{line.timestamp} </text>
                </Show>
                <text fg={getLineColor(line)}>{line.text}</text>
              </box>
            )}
          </For>
        </Show>
      </box>

      {/* Scroll position indicator */}
      <Show when={props.lines.length > contentHeight()}>
        <text fg={theme.textDim}>
          {`${String(scrollOffset() + 1)}-${String(Math.min(scrollOffset() + contentHeight(), props.lines.length))} of ${String(props.lines.length)} lines`}
        </text>
      </Show>
    </box>
  );
}
