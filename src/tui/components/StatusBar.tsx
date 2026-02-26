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
 * Bottom status bar with keyboard shortcut hints.
 */
export function StatusBar(props: StatusBarProps): JSX.Element {
  const isSplitMode = () => props.panelMode === 'split';

  // Format CPU display
  const cpuDisplay = () => (props.cpuPercent !== null ? `${String(props.cpuPercent)}%` : '—');

  // Format building indicator
  const buildingDisplay = () =>
    props.buildingCount > 0 ? ` | ${String(props.buildingCount)} building` : '';

  return (
    <box
      border="single"
      borderColor={theme.border}
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      {/* Left side: Keyboard hints */}
      <box gap={1}>
        <Show
          when={isSplitMode()}
          fallback={
            // Single mode shortcuts with panel indicator
            <>
              <box>
                <text backgroundColor={theme.toolBorder} color={theme.text}>
                  {' '}
                  Tab{' '}
                </text>
                <text> </text>
                <Show
                  when={props.activePanel === 'left'}
                  fallback={
                    <>
                      <text dim>Chat</text>
                      <text dim> │ </text>
                      <text backgroundColor={theme.secondary} color="#212121" bold>
                        {' '}
                        Dashboard{' '}
                      </text>
                    </>
                  }
                >
                  <>
                    <text backgroundColor={theme.secondary} color="#212121" bold>
                      {' '}
                      Chat{' '}
                    </text>
                    <text dim> │ </text>
                    <text dim>Dashboard</text>
                  </>
                </Show>
              </box>
              <box>
                <text backgroundColor={theme.toolBorder} color={theme.text}>
                  {' '}
                  /{' '}
                </text>
                <text dim> Commands</text>
              </box>
              <box>
                <text backgroundColor={theme.toolBorder} color={theme.text}>
                  {' '}
                  ?{' '}
                </text>
                <text dim> Help</text>
              </box>
              <box>
                <text backgroundColor={theme.toolBorder} color={theme.text}>
                  {' '}
                  ^C{' '}
                </text>
                <text dim> Exit</text>
              </box>
            </>
          }
        >
          {/* Split mode shortcuts */}
          <>
            <box>
              <text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                Tab{' '}
              </text>
              <text dim> Panel</text>
            </box>
            <box>
              <text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                /{' '}
              </text>
              <text dim> Commands</text>
            </box>
            <box>
              <text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ?{' '}
              </text>
              <text dim> Help</text>
            </box>
            <box>
              <text backgroundColor={theme.toolBorder} color={theme.text}>
                {' '}
                ^C{' '}
              </text>
              <text dim> Exit</text>
            </box>
          </>
        </Show>
      </box>

      {/* Right side: Summary (only in single mode) */}
      <Show when={!isSplitMode()}>
        <box>
          <text color={theme.muted}>
            {props.projectCount} project{props.projectCount !== 1 ? 's' : ''} │ CPU {cpuDisplay()}
            {buildingDisplay()}
          </text>
        </box>
      </Show>
    </box>
  );
}
