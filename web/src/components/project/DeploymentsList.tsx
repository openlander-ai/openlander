import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import {
  formatDeploymentDuration,
  getDeploymentStatusMeta,
  getDeploymentTriggerLabel,
  getShortCommitSha,
} from '@/lib/deployments';
import { useDeployments } from '@/hooks/use-deployments';
import { Skeleton } from '@/components/ui/skeleton';
import { GitBranch, GitCommit, Clock, Activity, History } from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { DeploymentHistoryFilter } from '@/types';

interface DeploymentsListProps {
  projectId: string;
  projectStatus?: string;
  projectBranch?: string;
  statusFilter?: DeploymentHistoryFilter;
  environmentId?: string;
}

export function DeploymentsList({
  projectId,
  projectStatus,
  projectBranch,
  statusFilter = 'all',
  environmentId,
}: DeploymentsListProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { deployments, loading, error, refetch } = useDeployments(
    projectId,
    projectStatus,
    environmentId,
  );
  const filteredDeployments = deployments.filter((deploy) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'in_progress') return false;
    return deploy.status === statusFilter;
  });

  if (loading) {
    return (
      <div className="p-4 space-y-2 h-full">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))] bg-bg-panel"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (filteredDeployments.length === 0) {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-secondary-ol">
          <History className="h-8 w-8 mb-3 text-muted-ol" />
          <p className="text-sm font-body">{'Failed to load deployments'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
            {'Try again'}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-12 text-secondary-ol">
        <History className="h-8 w-8 mb-3 text-muted-ol" />
        <p className="text-sm font-body">
          {statusFilter === 'all'
            ? t('projectDetail.noDeployments')
            : 'No deployments match this filter'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      {filteredDeployments.map((deploy) => {
        const statusMeta = getDeploymentStatusMeta(deploy.status);
        const shortCommitSha = getShortCommitSha(deploy.commitSha);

        return (
          <div
            key={deploy.id}
            onClick={() => navigate(`/projects/${projectId}/deployments/${deploy.id}`)}
            className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))] bg-bg-panel hover:border-agent/30 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusMeta.dotClass)} />
              <div className="flex flex-col">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-display font-medium text-primary-ol capitalize">
                    {getDeploymentTriggerLabel(deploy.trigger)}
                  </span>
                  <span
                    className={cn(
                      'text-[11px] font-body px-2 py-0.5 rounded-full bg-bg-subtle',
                      statusMeta.textClass,
                    )}
                  >
                    {statusMeta.label}
                  </span>
                  {shortCommitSha && (
                    <span className="flex items-center gap-1 text-xs font-mono text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                      <GitCommit className="h-3 w-3" />
                      {shortCommitSha}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs font-body text-secondary-ol flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(deploy.createdAt, t)}
                  </span>
                  {projectBranch && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {projectBranch}
                    </span>
                  )}
                  {deploy.durationMs && (
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {formatDeploymentDuration(deploy.durationMs)}
                    </span>
                  )}
                </div>
                {deploy.failureSummary && (
                  <p className="mt-1 text-xs font-body text-error line-clamp-2">
                    {deploy.failureSummary}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
