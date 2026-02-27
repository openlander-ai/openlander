import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { theme, SplitBorder } from '../theme.js';

interface LayoutProps {
  left: JSX.Element;
  right: JSX.Element;
  statusBar: JSX.Element;
  // overlay prop removed — overlays now rendered at App level for proper useKeyboard lifecycle
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
  // Two-tier responsive: ≥120 → 60:40, 80-119 → 65:35, <80 → single panel
  const isWideMode = () => columns() >= 80;
  const isExtraWide = () => columns() >= 120;
  const leftWidth = () => {
    if (isExtraWide()) return Math.floor(columns() * 0.6);
    if (isWideMode()) return Math.floor(columns() * 0.65);
    return '100%';
  };
  const rightWidth = () => {
    if (isExtraWide()) return Math.floor(columns() * 0.4);
    if (isWideMode()) return Math.floor(columns() * 0.35);
    return '100%';
  };
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
            <box
              width="100%"
              flexDirection="column"
              overflow="hidden"
              border={['top']}
              borderColor={theme.borderActive}
            >
              <Show when={props.activePanel === 'left'} fallback={props.right}>
                {props.left}
              </Show>
            </box>
          }
        >
          {/* Wide mode: both panels side by side with pipe divider */}
          <>
            <box
              width={leftWidth()}
              flexDirection="column"
              overflow="hidden"
              paddingRight={1}
              border={['top']}
              borderColor={props.activePanel === 'left' ? theme.borderActive : theme.borderSubtle}
            >
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

            <box
              width={rightWidth()}
              flexDirection="column"
              overflow="hidden"
              paddingLeft={1}
              border={['top']}
              borderColor={props.activePanel === 'right' ? theme.borderActive : theme.borderSubtle}
            >
              {props.right}
            </box>
          </>
        </Show>
      </box>

      {/* Footer bar */}
      {props.statusBar}
    </box>
  );
}
