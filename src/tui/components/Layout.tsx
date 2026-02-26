import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';

interface LayoutProps {
  left: JSX.Element;
  right: JSX.Element;
  statusBar: JSX.Element;
  overlay?: JSX.Element;
  activePanel?: 'left' | 'right';
}

/**
 * Split-panel layout with responsive behavior.
 *
 * - columns >= 100: 55/45 split with left and right panels side by side
 * - columns < 100: single panel mode, controlled by activePanel prop
 */
export function Layout(props: LayoutProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims.columns;
  const rows = () => dims.rows;

  const isWideMode = () => columns() >= 100;

  // Calculate panel widths in wide mode
  const leftWidth = () => (isWideMode() ? Math.floor(columns() * 0.55) : '100%');
  const rightWidth = () => (isWideMode() ? Math.floor(columns() * 0.45) : '100%');

  // Reserve 1 row for status bar
  const contentHeight = () => rows() - 1;

  return (
    <box flexDirection="column" height={rows()} width={columns()}>
      {/* Main content area */}
      <box flexDirection="row" flexGrow={1} height={contentHeight()} overflow="hidden">
        <Show
          when={isWideMode()}
          fallback={
            // Narrow mode: single panel at a time
            <box width="100%" flexDirection="column" overflow="hidden">
              <Show when={props.activePanel === 'left'} fallback={props.right}>
                {props.left}
              </Show>
            </box>
          }
        >
          {/* Wide mode: both panels side by side */}
          <>
            {/* Left panel - has right border as divider */}
            <box
              width={leftWidth()}
              flexDirection="column"
              border="single"
              borderRight={true}
              borderLeft={false}
              borderTop={false}
              borderBottom={false}
              overflow="hidden"
            >
              {props.left}
            </box>

            {/* Right panel - no borders */}
            <box width={rightWidth()} flexDirection="column" overflow="hidden">
              {props.right}
            </box>
          </>
        </Show>
      </box>

      {/* Status bar at bottom */}
      {props.statusBar}

      {/* Overlay on top of everything */}
      <Show when={props.overlay}>
        <box position="absolute" width={columns()} height={rows()} flexDirection="column">
          {props.overlay}
        </box>
      </Show>
    </box>
  );
}
