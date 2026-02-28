import type { JSX } from 'solid-js';
import { Show, Switch, Match } from 'solid-js';
import { type TuiMode, buildSessionCount } from '../state/mode.js';
import { theme } from '../theme.js';

interface StatusBarProps {
  panelMode: 'split' | 'single';
  activePanel: 'left' | 'right';
  projectCount: number;
  cpuPercent: number | null;
  buildingCount: number;
  /** Current TUI mode — controls which hints and stats are shown. */
  mode: TuiMode;
  /** Name of project being deployed (deploying mode). */
  deployProjectName?: string;
  /** Name of project being debugged (debugging mode). */
  debugProjectName?: string;
  /** Memory display string (e.g., "4.2G", "128M"). */
  memDisplay: string;
  /** Debug port for the project (debugging mode). */
  debugPort: number | null;
  /** Build progress percentage 0-100 (deploying mode). */
  buildProgress: number | null;
}

/**
 * Bottom footer bar — mode-aware with keybind hints and status indicators.
 *
 * - Monitoring: Tab/Commands/Help/Exit hints + project count + CPU
 * - Deploying:  Cancel/Close hints + build name + CPU
 * - Debugging:  Back/Redeploy/Stop hints + project name + CPU
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const isSplitMode = () => props.panelMode === 'split';
  const cpuDisplay = () => (props.cpuPercent !== null ? `${String(props.cpuPercent)}%` : '—');

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
    >
      {/* Left side: Mode-specific keybind hints */}
      <box gap={2} flexDirection="row">
        <Switch>
          <Match when={props.mode === 'deploying'}>
            <KeyHint key="^C" label="Cancel" />
            <KeyHint key="Enter" label="Close" />
            <Show when={buildSessionCount() > 1}>
              <KeyHint key="←→" label="Switch Build" />
            </Show>
          </Match>
          <Match when={props.mode === 'debugging'}>
            <KeyHint key="Esc" label="Back" />
            <KeyHint key="r" label="Redeploy" />
            <KeyHint key="s" label="Stop" />
            <KeyHint key="d" label="Domain" />
          </Match>
          <Match when={props.mode === 'monitoring'}>
            <Show
              when={!isSplitMode()}
              fallback={
                <>
                  <box flexDirection="row" gap={1}>
                    <text backgroundColor={theme.backgroundElement} fg={theme.text}>
                      {' '}
                      Tab{' '}
                    </text>
                    <text fg={props.activePanel === 'left' ? theme.secondary : theme.textDim}>
                      Chat
                    </text>
                    <text fg={theme.textDim}> │ </text>
                    <text fg={props.activePanel === 'right' ? theme.secondary : theme.textDim}>
                      Status
                    </text>
                  </box>
                  <KeyHint key="/" label="Commands" />
                  <KeyHint key="?" label="Help" />
                  <KeyHint key="^C" label="Exit" />
                </>
              }
            >
              {/* Single mode: show active panel indicator */}
              <box flexDirection="row" gap={1}>
                <text backgroundColor={theme.backgroundElement} fg={theme.text}>
                  {' '}
                  Tab{' '}
                </text>
                <Show
                  when={props.activePanel === 'left'}
                  fallback={
                    <box flexDirection="row">
                      <text fg={theme.textDim}>Chat</text>
                      <text fg={theme.textDim}> │ </text>
                      <text backgroundColor={theme.secondary} fg={theme.text} bold={true}>
                        {' '}
                        Status{' '}
                      </text>
                    </box>
                  }
                >
                  <box flexDirection="row">
                    <text backgroundColor={theme.secondary} fg={theme.text} bold={true}>
                      {' '}
                      Chat{' '}
                    </text>
                    <text fg={theme.textDim}> │ </text>
                    <text fg={theme.textDim}>Status</text>
                  </box>
                </Show>
              </box>
              <KeyHint key="/" label="Commands" />
              <KeyHint key="?" label="Help" />
              <KeyHint key="^C" label="Exit" />
            </Show>
          </Match>
        </Switch>
      </box>

      {/* Right side: Mode-specific status */}
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={props.mode === 'deploying'}>
            <text fg={theme.warning} bold={true}>
              BUILD {props.deployProjectName ?? '...'}
              {props.buildProgress != null ? ` ${String(props.buildProgress)}%` : ''}
            </text>
            <text fg={theme.textMuted}>CPU {cpuDisplay()} MEM {props.memDisplay}</text>
          </Match>
          <Match when={props.mode === 'debugging'}>
            <text fg={theme.success}>
              {props.debugProjectName ?? '...'} ●
              {props.debugPort != null ? ` :${String(props.debugPort)}` : ''}
            </text>
            <text fg={theme.textMuted}>CPU {cpuDisplay()} MEM {props.memDisplay}</text>
          </Match>
          <Match when={props.mode === 'monitoring'}>
            <text fg={theme.textMuted}>
              {props.projectCount} project{props.projectCount !== 1 ? 's' : ''}
            </text>
            <text fg={theme.textMuted}>CPU {cpuDisplay()} MEM {props.memDisplay}</text>
            <Show when={props.buildingCount > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>●</span>
                {` ${String(props.buildingCount)} building`}
              </text>
            </Show>
          </Match>
        </Switch>
      </box>
    </box>
  );
}

/** Small keybind hint component */
function KeyHint(props: { key: string; label: string }): JSX.Element {
  return (
    <box flexDirection="row" gap={0}>
      <text backgroundColor={theme.backgroundElement} fg={theme.text}>
        {' '}
        {props.key}{' '}
      </text>
      <text fg={theme.textMuted}> {props.label}</text>
    </box>
  );
}
