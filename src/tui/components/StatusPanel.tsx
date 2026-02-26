/**
 * Adaptive right panel that switches content based on TUI mode.
 *
 * - monitoring: Full DashboardPanel (System + Projects + Activity + MCP)
 * - deploying:  Compact DashboardPanel + BuildPanel
 * - debugging:  ProjectInfo + LogViewer
 */
import type { JSX } from 'solid-js';
import { Switch, Match } from 'solid-js';
import type { TuiMode, DeployingState, DebuggingState } from '../state/mode.js';
import type { OpenLanderClient } from '../../ipc/client.js';
import { DashboardPanel } from './DashboardPanel.js';
import { BuildPanel } from './BuildPanel.js';
import { ProjectInfo } from './ProjectInfo.js';
import { LogViewer } from './LogViewer.js';

interface StatusPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  mode: TuiMode;
  deployingState: DeployingState | null;
  debuggingState: DebuggingState | null;
  onStatsUpdate?: (data: {
    projectCount: number;
    cpuPercent: number | null;
    buildingCount: number;
  }) => void;
  onProjectSelect?: (projectId: string, projectName: string) => void;
}

export function StatusPanel(props: StatusPanelProps): JSX.Element {
  return (
    <Switch>
      <Match when={props.mode === 'monitoring'}>
        <DashboardPanel
          client={props.client}
          height={props.height}
          focus={props.focus}
          onStatsUpdate={props.onStatsUpdate}
          onProjectSelect={props.onProjectSelect}
        />
      </Match>
      <Match when={props.mode === 'deploying'}>
        <box flexDirection="column" flexGrow={1}>
          <DashboardPanel
            client={props.client}
            height={Math.floor(props.height * 0.4)}
            focus={false}
            compact={true}
          />
          <BuildPanel
            projectId={props.deployingState?.projectId ?? ''}
            client={props.client}
            height={Math.floor(props.height * 0.6)}
            focus={props.focus}
          />
        </box>
      </Match>
      <Match when={props.mode === 'debugging'}>
        <box flexDirection="column" flexGrow={1}>
          <ProjectInfo
            projectId={props.debuggingState?.projectId ?? ''}
            projectName={props.debuggingState?.projectName ?? ''}
            client={props.client}
            height={Math.floor(props.height * 0.35)}
          />
          <LogViewer
            projectId={props.debuggingState?.projectId ?? ''}
            projectName={props.debuggingState?.projectName ?? ''}
            client={props.client}
            height={Math.floor(props.height * 0.65)}
            focus={props.focus}
          />
        </box>
      </Match>
    </Switch>
  );
}
