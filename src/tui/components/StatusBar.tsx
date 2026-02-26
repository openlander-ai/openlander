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
            <text backgroundColor={theme.backgroundElement} color={theme.text}>
              {' '}
              Tab{' '}
            </text>
            <Show
              when={props.activePanel === 'left'}
              fallback={
                <box flexDirection="row">
                  <text color={theme.textDim}>Chat</text>
                  <text color={theme.textDim}> │ </text>
                  <text backgroundColor={theme.secondary} color={theme.background} bold={true}>
                    {' '}
                    Dashboard{' '}
                  </text>
                </box>
              }
            >
              <box flexDirection="row">
                <text backgroundColor={theme.secondary} color={theme.background} bold={true}>
                  {' '}
                  Chat{' '}
                </text>
                <text color={theme.textDim}> │ </text>
                <text color={theme.textDim}>Dashboard</text>
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
        <text color={theme.textMuted}>
          {props.projectCount} project{props.projectCount !== 1 ? 's' : ''}
        </text>
        <text color={theme.textMuted}>CPU {cpuDisplay()}</text>
        <Show when={props.buildingCount > 0}>
          <text color={theme.warning}>
            <span color={theme.warning}>●</span>
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
      <text backgroundColor={theme.backgroundElement} color={theme.text}>
        {' '}
        {props.key}{' '}
      </text>
      <text color={theme.textMuted}> {props.label}</text>
    </box>
  );
}
