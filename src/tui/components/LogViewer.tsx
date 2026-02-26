/**
 * Log viewer placeholder — shown in debug mode (bottom section).
 * Full implementation in Phase 4 (real-time log streaming with auto-scroll).
 */
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';
import type { OpenLanderClient } from '../../ipc/client.js';

interface LogViewerProps {
  projectId: string;
  projectName: string;
  client: OpenLanderClient | null;
  height: number;
}

export function LogViewer(props: LogViewerProps): JSX.Element {
  return (
    <box
      flexDirection="column"
      height={props.height}
      paddingLeft={2}
      paddingTop={1}
      borderColor={props.projectId ? theme.border : theme.border}
    >
      <text bold={true} fg={theme.text}>
        ▸ Logs
      </text>
      <text fg={theme.textMuted} paddingLeft={2}>
        Log viewer — Phase 4
      </text>
      <text fg={theme.textDim} paddingLeft={2}>
        Press Esc to return to monitoring
      </text>
    </box>
  );
}
