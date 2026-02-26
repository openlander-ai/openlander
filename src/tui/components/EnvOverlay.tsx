import type { JSX } from 'solid-js';
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

interface EnvOverlayProps {
  onClose: () => void;
}

/**
 * Placeholder overlay for environment variable management.
 * Full implementation in Phase 8.
 */
export function EnvOverlay(props: EnvOverlayProps): JSX.Element {
  const dims = useTerminalDimensions();
  const columns = () => dims().width;
  const rows = () => dims().height;

  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (evt.name === 'escape' || evt.name === 'enter') {
      props.onClose();
    }
  });

  const contentWidth = 60;

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
        width={contentWidth}
        backgroundColor={theme.backgroundMenu}
      >
        <box marginBottom={1} justifyContent="center">
          <text bold={true} fg={theme.text}>
            Environment Variables
          </text>
        </box>
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.textMuted}>Environment variable management coming soon.</text>
          <text fg={theme.textDim}>This feature will be available in a future update.</text>
        </box>
        <box marginTop={1} justifyContent="center">
          <text fg={theme.textDim}>[Enter/Esc Close]</text>
        </box>
      </box>
    </box>
  );
}
