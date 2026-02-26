/**
 * Build panel placeholder — shown in deploy mode.
 * Full implementation in Phase 3 (pipeline visualization + build log streaming).
 */
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';
import type { OpenLanderClient } from '../../ipc/client.js';

interface BuildPanelProps {
  projectId: string;
  client: OpenLanderClient | null;
  height: number;
}

export function BuildPanel(props: BuildPanelProps): JSX.Element {
  return (
    <box
      flexDirection="column"
      height={props.height}
      paddingLeft={2}
      paddingTop={1}
      borderColor={props.projectId ? theme.warning : theme.border}
    >
      <text bold={true} fg={theme.warning}>
        ▸ Build
      </text>
      <text fg={theme.textMuted} paddingLeft={2}>
        Build panel — Phase 3
      </text>
    </box>
  );
}
