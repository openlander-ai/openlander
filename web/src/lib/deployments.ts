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
        label: 'Production',
      };
    case 'failed':
      return {
        dotClass: 'bg-error',
        textClass: 'text-error',
        label: 'Failed',
      };
    default:
      return {
        dotClass: 'bg-[var(--text-muted)]',
        textClass: 'text-muted-ol',
        label: 'Cancelled',
      };
  }
}

export function getDeploymentTriggerLabel(trigger: DeployLogSummary['trigger']): string {
  return `${trigger} Deployment`;
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
    return Boolean(deploy.isInProgress);
  }

  return deploy.status === filter;
}
