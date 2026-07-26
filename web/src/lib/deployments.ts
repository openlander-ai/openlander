import type { DeploymentHistoryFilter, DeploymentViewModel, DeployLogSummary } from '@/types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export const DEPLOYMENT_HISTORY_FILTERS: DeploymentHistoryFilter[] = [
  'all',
  'failed',
  'success',
  'in_progress',
];

export function getDeploymentStatusMeta(status: DeployLogSummary['status'], t: Translate) {
  switch (status) {
    case 'success':
      return {
        dotClass: 'bg-success',
        textClass: 'text-success',
        label: t('deploy.detail.statusValue.success'),
      };
    case 'failed':
      return {
        dotClass: 'bg-error',
        textClass: 'text-error',
        label: t('deploy.detail.statusValue.failed'),
      };
    case 'building':
      return {
        dotClass: 'bg-agent animate-pulse',
        textClass: 'text-agent',
        label: t('deploy.detail.statusValue.building'),
      };
    default:
      return {
        dotClass: 'bg-muted-foreground/40',
        textClass: 'text-muted-foreground',
        label: t('deploy.detail.statusValue.cancelled'),
      };
  }
}

export function getDeploymentTriggerLabel(
  trigger: DeployLogSummary['trigger'],
  triggerDetail: string | null | undefined,
  t: Translate,
): string {
  if (triggerDetail) {
    switch (triggerDetail) {
      case 'restart':
        return t('deploy.triggerAction.restart');
      case 'env_update':
        return t('deploy.triggerAction.envUpdate');
      case 'deploy':
        return t('deploy.triggerAction.deploy');
      case 'deploy_plan':
        return t('deploy.triggerAction.deployPlan');
      default:
        return triggerDetail;
    }
  }
  switch (trigger) {
    case 'chat':
      return t('deploy.triggerAction.chat');
    case 'webhook':
      return t('deploy.triggerAction.webhook');
    case 'api':
      return t('deploy.triggerAction.api');
    default:
      return t('deploy.triggerAction.deploy');
  }
}

export function getDeploymentTriggerIcon(trigger: DeployLogSummary['trigger']): string {
  switch (trigger) {
    case 'chat':
      return 'Bot';
    case 'webhook':
      return 'Webhook';
    case 'api':
      return 'Zap';
    default:
      return 'Rocket';
  }
}

export function getDeploymentTriggerMetaLabel(
  trigger: DeployLogSummary['trigger'],
  t: Translate,
): string {
  switch (trigger) {
    case 'chat':
      return t('deploy.detail.triggerValue.chat');
    case 'webhook':
      return t('deploy.detail.triggerValue.webhook');
    case 'api':
      return t('deploy.detail.triggerValue.api');
  }
}

export function getShortCommitSha(commitSha: string | null): string | null {
  return commitSha ? commitSha.substring(0, 7) : null;
}

export function formatDeploymentDuration(durationMs: number | null): string {
  if (!durationMs) {
    return 'Duration unavailable';
  }

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function matchesDeploymentHistoryFilter(
  deploy: DeploymentViewModel,
  filter: DeploymentHistoryFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'in_progress') {
    return deploy.status === 'building' || Boolean(deploy.isInProgress);
  }

  return deploy.status === filter;
}
