export type TerminalAvailabilityState = {
  canConnect: boolean;
  badge: string;
  title: string;
  detail: string;
};

export function getTerminalAvailabilityState(
  projectStatus: string,
  isConsoleActive: boolean,
  t: (key: string) => string,
): TerminalAvailabilityState {
  if (projectStatus === 'running') {
    if (isConsoleActive) {
      return {
        canConnect: true,
        badge: t('logs.terminalReadyBadge'),
        title: t('logs.terminalReadyTitle'),
        detail: t('logs.terminalReadyBody'),
      };
    }

    return {
      canConnect: false,
      badge: t('logs.terminalStandbyBadge'),
      title: t('logs.terminalStandbyTitle'),
      detail: t('logs.terminalStandbyBody'),
    };
  }

  if (projectStatus === 'building') {
    return {
      canConnect: false,
      badge: t('logs.terminalUnavailableBadge'),
      title: t('logs.terminalBuildingTitle'),
      detail: t('logs.terminalBuildingBody'),
    };
  }

  if (projectStatus === 'error') {
    return {
      canConnect: false,
      badge: t('logs.terminalUnavailableBadge'),
      title: t('logs.terminalProjectErrorTitle'),
      detail: t('logs.terminalProjectErrorBody'),
    };
  }

  return {
    canConnect: false,
    badge: t('logs.terminalUnavailableBadge'),
    title: t('logs.terminalInactiveTitle'),
    detail: t('logs.terminalInactiveBody'),
  };
}
