import { describe, expect, it } from 'vitest';

import { getTerminalAvailabilityState } from '../web/src/components/terminal/terminalAvailability';

const messages = {
  'logs.terminalReadyBadge': 'Ready',
  'logs.terminalReadyTitle': 'Terminal ready',
  'logs.terminalReadyBody': 'Logs stay live while the shell is open.',
  'logs.terminalStandbyBadge': 'Standby',
  'logs.terminalStandbyTitle': 'Terminal on standby',
  'logs.terminalStandbyBody': 'Logs keep streaming. Open the Console tab to reconnect the shell.',
  'logs.terminalUnavailableBadge': 'Unavailable',
  'logs.terminalBuildingTitle': 'Terminal unavailable during build',
  'logs.terminalBuildingBody':
    'Use live logs while the next runnable container is still starting up.',
  'logs.terminalProjectErrorTitle': 'Terminal unavailable while the project is failing',
  'logs.terminalProjectErrorBody':
    'Use logs to inspect the failure. The shell returns after the container is running again.',
  'logs.terminalInactiveTitle': 'Terminal unavailable',
  'logs.terminalInactiveBody':
    'No running container is available yet. Logs remain the best source of recent output.',
} as const;

const t = (key: string) => messages[key as keyof typeof messages] ?? key;

describe('getTerminalAvailabilityState', () => {
  it('keeps the terminal connectable only when the console is active and the project is running', () => {
    expect(getTerminalAvailabilityState('running', true, t)).toEqual({
      canConnect: true,
      badge: 'Ready',
      title: 'Terminal ready',
      detail: 'Logs stay live while the shell is open.',
    });

    expect(getTerminalAvailabilityState('running', false, t)).toEqual({
      canConnect: false,
      badge: 'Standby',
      title: 'Terminal on standby',
      detail: 'Logs keep streaming. Open the Console tab to reconnect the shell.',
    });
  });

  it('explains why the terminal is unavailable for non-runnable project states', () => {
    expect(getTerminalAvailabilityState('building', true, t)).toEqual({
      canConnect: false,
      badge: 'Unavailable',
      title: 'Terminal unavailable during build',
      detail: 'Use live logs while the next runnable container is still starting up.',
    });

    expect(getTerminalAvailabilityState('error', true, t)).toEqual({
      canConnect: false,
      badge: 'Unavailable',
      title: 'Terminal unavailable while the project is failing',
      detail:
        'Use logs to inspect the failure. The shell returns after the container is running again.',
    });

    expect(getTerminalAvailabilityState('stopped', true, t)).toEqual({
      canConnect: false,
      badge: 'Unavailable',
      title: 'Terminal unavailable',
      detail:
        'No running container is available yet. Logs remain the best source of recent output.',
    });
  });
});
