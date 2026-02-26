/**
 * Project info placeholder — shown in debug mode (top section).
 * Full implementation in Phase 4 (status, port, domain, image, uptime, CPU, MEM).
 */
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';
import type { OpenLanderClient } from '../../ipc/client.js';

interface ProjectInfoProps {
  projectId: string;
  projectName: string;
  client: OpenLanderClient | null;
  height: number;
}

export function ProjectInfo(props: ProjectInfoProps): JSX.Element {
  return (
    <box flexDirection="column" height={props.height} paddingLeft={2} paddingTop={1}>
      <text bold={true} fg={theme.text}>
        ▸ {props.projectName || 'Project'}
      </text>
      <text fg={theme.textMuted} paddingLeft={2}>
        Project info — Phase 4
      </text>
    </box>
  );
}
