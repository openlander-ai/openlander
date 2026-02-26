import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { theme } from '../theme.js';

interface StatusBarProps {
  panelMode: 'split' | 'single';
  activePanel: 'left' | 'right';
  projectCount: number;
  cpuPercent: number | null;
  buildingCount: number;
}

/**
 * Bottom footer bar — OpenCode-inspired with keybind hints and status indicators.
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const isSplitMode = () => props.panelMode === 'split';
  const cpuDisplay = () => (props.cpuPercent !== null ? `${String(props.cpuPercent)}%` : '—');
  const buildingDisplay = () =>
    props.buildingCount > 0 ? ` ${String(props.buildingCount)} building` : '';

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
    >
      {/* Left side: Keybind hints */}
      <box gap={2} flexDirection="row">
        <Show
          when={!isSplitMode()}
          fallback={
            <>
              <KeyHint key="Tab" label="Panel" />
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
                  <text backgroundColor={theme.secondary} fg={theme.background} bold={true}>
                    {' '}
                    Dashboard{' '}
                  </text>
                </box>
              }
            >
              <box flexDirection="row">
                <text backgroundColor={theme.secondary} fg={theme.background} bold={true}>
                  {' '}
                  Chat{' '}
                </text>
                <text fg={theme.textDim}> │ </text>
                <text fg={theme.textDim}>Dashboard</text>
              </box>
            </Show>
          </box>
          <KeyHint key="/" label="Commands" />
          <KeyHint key="?" label="Help" />
          <KeyHint key="^C" label="Exit" />
        </Show>
      </box>

      {/* Right side: Status summary */}
      <box gap={2} flexDirection="row" flexShrink={0}>
        <text fg={theme.textMuted}>
          {props.projectCount} project{props.projectCount !== 1 ? 's' : ''}
        </text>
        <text fg={theme.textMuted}>CPU {cpuDisplay()}</text>
        <Show when={props.buildingCount > 0}>
          <text fg={theme.warning}>
            <span style={{ fg: theme.warning }}>●</span>
            {buildingDisplay()}
          </text>
        </Show>
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
