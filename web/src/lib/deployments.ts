import type { DeploymentHistoryFilter, DeploymentViewModel, DeployLogSummary } from '@/types';

export const DEPLOYMENT_HISTORY_FILTERS: DeploymentHistoryFilter[] = [
  'all',
  'failed',
  'success',
  'in_progress',
];

export function getDeploymentStatusMeta(status: DeployLogSummary['status']) {
  switch (status) {
    case 'success':
      return {
        dotClass: 'bg-success',
        textClass: 'text-success',
        label: 'Success',
      };
    case 'failed':
      return {
        dotClass: 'bg-error',
        textClass: 'text-error',
        label: 'Failed',
      };
    case 'building':
      return {
        dotClass: 'bg-agent animate-pulse',
        textClass: 'text-agent',
        label: 'Building',
      };
    default:
      return {
        dotClass: 'bg-muted-foreground/40',
        textClass: 'text-muted-foreground',
        label: 'Cancelled',
      };
  }
}

export function getDeploymentTriggerLabel(
  trigger: DeployLogSummary['trigger'],
  triggerDetail?: string | null,
): string {
  if (triggerDetail) {
    switch (triggerDetail) {
      case 'restart':
        return 'Restart';
      case 'env_update':
        return 'Env Update';
      case 'deploy':
        return 'Deploy';
      case 'deploy_plan':
        return 'Deploy Plan';
      default:
        return triggerDetail;
    }
  }
  switch (trigger) {
    case 'chat':
      return 'Agent Deploy';
    case 'webhook':
      return 'Webhook';
    case 'api':
      return 'API Call';
    default:
      return 'Deploy';
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

export function getDeploymentTriggerMetaLabel(trigger: DeployLogSummary['trigger']): string {
  return `${trigger} trigger`;
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
