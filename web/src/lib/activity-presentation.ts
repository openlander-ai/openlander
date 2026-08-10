import type { ActivityEvent } from './agentActivity';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function localizedActivityDetail(event: ActivityEvent, t: Translate): string | undefined {
  if (!event.detailCode) return event.detail;
  return t(`activity.detail.${event.detailCode}`, event.detailParams);
}

export function localizedActivityTitle(event: ActivityEvent, t: Translate): string {
  if (event.titleCode) {
    const titleKey = {
      public_access_enabled: 'publicAccessEnabled',
      public_access_disabled: 'publicAccessDisabled',
      public_access_code_rotated: 'publicAccessCodeRotated',
      public_access_verification_failed: 'publicAccessVerificationFailed',
    }[event.titleCode];
    return t(`activity.eventTitle.${titleKey}`);
  }
  const deploySuffix = event.title.match(/ · [a-f0-9]{7,40}$/i)?.[0] ?? '';
  switch (event.kind) {
    case 'deploy_started':
      return `${t('activity.eventTitle.deployStarted')}${deploySuffix}`;
    case 'deploy_completed':
      return `${t('activity.eventTitle.deployCompleted')}${deploySuffix}`;
    case 'deploy_failed':
      return `${t('activity.eventTitle.deployFailed')}${deploySuffix}`;
    case 'deploy_cancelled':
      return `${t('activity.eventTitle.deployCancelled')}${deploySuffix}`;
    case 'config_changed':
      return t('activity.eventTitle.configChanged');
    case 'data_access_read':
      return t('activity.eventTitle.dataAccessRead', {
        operation: event.dataAccess?.operation ?? '—',
      });
    case 'service_crashed':
      return t('activity.eventTitle.serviceCrashed');
    case 'service_recovered':
      return t('activity.eventTitle.serviceRecovered');
    case 'mcp_connected':
      return t('activity.eventTitle.mcpConnected', {
        identity: event.title.replace(/\s+connected$/i, ''),
      });
    case 'mcp_disconnected':
      return t('activity.eventTitle.mcpDisconnected', {
        identity: event.title.replace(/\s+disconnected$/i, ''),
      });
  }
}

export function localizedActivityRelativeTime(event: ActivityEvent, t: Translate): string {
  if (event.relTs < 60) return t('common.relative.justNow');
  if (event.relTs < 3600) {
    return t('common.relative.minutes', { count: Math.floor(event.relTs / 60) });
  }
  if (event.relTs < 86400) {
    return t('common.relative.hours', { count: Math.floor(event.relTs / 3600) });
  }
  return t('common.relative.days', { count: Math.floor(event.relTs / 86400) });
}
