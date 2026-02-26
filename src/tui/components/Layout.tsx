import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { theme, SplitBorder } from '../theme.js';

interface LayoutProps {
  left: JSX.Element;
  right: JSX.Element;
  statusBar: JSX.Element;
  overlay?: JSX.Element;
  activePanel?: 'left' | 'right';
  columns: number;
  rows: number;
}

/**
 * Split-panel layout with responsive behavior.
 * OpenCode-inspired: clean edge-to-edge design, pipe divider, dark background.
 */
export function Layout(props: LayoutProps): JSX.Element {
  const columns = () => props.columns;
  const rows = () => props.rows;
  const isWideMode = () => columns() >= 100;
  const leftWidth = () => (isWideMode() ? Math.floor(columns() * 0.55) : '100%');
  const rightWidth = () => (isWideMode() ? Math.floor(columns() * 0.45) : '100%');
  const contentHeight = () => rows() - 1;

  return (
    <box
      flexDirection="column"
      height={rows()}
      width={columns()}
      backgroundColor={theme.background}
    >
      {/* Main content area with padding */}
      <box
        flexDirection="row"
        flexGrow={1}
        height={contentHeight()}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
      >
        <Show
          when={isWideMode()}
          fallback={
            <box width="100%" flexDirection="column" overflow="hidden">
              <Show when={props.activePanel === 'left'} fallback={props.right}>
                {props.left}
              </Show>
            </box>
          }
        >
          {/* Wide mode: both panels side by side with pipe divider */}
          <>
            <box width={leftWidth()} flexDirection="column" overflow="hidden" paddingRight={1}>
              {props.left}
            </box>

            {/* Pipe divider using SplitBorder pattern */}
            <box
              width={1}
              flexDirection="column"
              border={['left']}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={theme.borderSubtle}
              flexShrink={0}
            />

            <box width={rightWidth()} flexDirection="column" overflow="hidden" paddingLeft={1}>
              {props.right}
            </box>
          </>
        </Show>
      </box>

      {/* Footer bar */}
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
