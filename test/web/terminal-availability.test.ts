import { describe, expect, it } from 'vitest';

import { getTerminalAvailabilityState } from '../../web/src/components/terminal/terminalAvailability';

describe('terminal availability helper', () => {
  const t = (key: string) => key;

  it('keeps a running Console session connectable', () => {
    expect(getTerminalAvailabilityState('running', true, t)).toEqual({
      canConnect: true,
      badge: 'logs.terminalReadyBadge',
      title: 'logs.terminalReadyTitle',
      detail: 'logs.terminalReadyBody',
    });
  });

  it('keeps standby, build, and project-error cases distinct', () => {
    expect(getTerminalAvailabilityState('running', false, t)).toEqual({
      canConnect: false,
      badge: 'logs.terminalStandbyBadge',
      title: 'logs.terminalStandbyTitle',
      detail: 'logs.terminalStandbyBody',
    });

    expect(getTerminalAvailabilityState('building', false, t)).toEqual({
      canConnect: false,
      badge: 'logs.terminalUnavailableBadge',
      title: 'logs.terminalBuildingTitle',
      detail: 'logs.terminalBuildingBody',
    });

    expect(getTerminalAvailabilityState('error', false, t)).toEqual({
      canConnect: false,
      badge: 'logs.terminalUnavailableBadge',
      title: 'logs.terminalProjectErrorTitle',
      detail: 'logs.terminalProjectErrorBody',
    });
  });
});
