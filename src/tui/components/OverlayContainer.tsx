import type { JSX } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

interface OverlayContainerProps {
  /** Dialog title shown in header */
  title: string;
  /** Fixed content width. Default: 60 */
  width?: number;
  /** Use responsive width: min(width, terminal_cols - 4). Default: false */
  responsive?: boolean;
  /** Footer hint text, e.g. "[↑↓ Navigate] [Enter Select] [Esc Close]" */
  footer?: string;
  /** Child content rendered inside the dialog */
  children: JSX.Element;
}

export function OverlayContainer(props: OverlayContainerProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  const contentWidth = () => {
    const base = props.width ?? 60;
    return props.responsive ? Math.min(base, columns() - 4) : base;
  };

  return (
    <box
      flexDirection="column"
      width={columns()}
      height={rows()}
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme.background}
    >
      <box
        flexDirection="column"
        border="round"
        borderColor={theme.borderActive}
        paddingX={2}
        paddingY={1}
        width={contentWidth()}
        backgroundColor={theme.backgroundMenu}
      >
        {/* Header */}
        <box marginBottom={1} justifyContent="center">
          <text bold={true} fg={theme.text}>
            {props.title}
          </text>
        </box>

        {/* Content */}
        {props.children}

        {/* Footer */}
        {props.footer ? (
          <box marginTop={1} justifyContent="center">
            <text fg={theme.textDim}>{props.footer}</text>
          </box>
        ) : null}
      </box>
    </box>
  );
}
