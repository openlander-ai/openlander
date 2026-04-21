import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import {
  formatDeploymentDuration,
  getDeploymentStatusMeta,
  getDeploymentTriggerLabel,
  getDeploymentTriggerIcon,
  getShortCommitSha,
} from '@/lib/deployments';
import { useDeployments } from '@/hooks/use-deployments';
import { Skeleton } from '@/components/ui/skeleton';
import { GitBranch, Clock, Activity, History, Bot, Webhook, Zap, Rocket } from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { DeploymentHistoryFilter } from '@/types';

interface DeploymentsListProps {
  projectId: string;
  projectStatus?: string;
  projectBranch?: string;
  statusFilter?: DeploymentHistoryFilter;
}

export function DeploymentsList({
  projectId,
  projectStatus,
  projectBranch,
  statusFilter = 'all',
}: DeploymentsListProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { deployments, loading, error, refetch } = useDeployments(projectId, projectStatus);
  const filteredDeployments = deployments.filter((deploy) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'in_progress') return false;
    return deploy.status === statusFilter;
  });

  if (loading) {
    return (
      <div className="flex flex-col h-full p-6 bg-bg-app">
        <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm overflow-hidden flex-1">
          <div className="divide-y divide-border/50 h-full">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 px-4">
                <Skeleton className="h-2 w-2 rounded-full shrink-0" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
                <div className="flex-1" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (filteredDeployments.length === 0) {
    if (error) {
      return (
        <div className="flex flex-col h-full p-6 bg-bg-app">
          <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm flex flex-col items-center justify-center flex-1 py-12 text-foreground/80">
            <History className="h-8 w-8 mb-3 text-muted-foreground" />
            <p className="text-sm font-body">{'Failed to load deployments'}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>
              {'Try again'}
            </Button>
          </div>
        </div>
      );
    }

    <div className="flex flex-col h-full p-6 bg-bg-app">
      <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm flex flex-col items-center justify-center flex-1 py-12 text-foreground/80">
        <History className="h-8 w-8 mb-3 text-muted-foreground" />
        <p className="text-sm font-body">
          {statusFilter === 'all'
            ? t('projectDetail.noDeployments')
            : 'No deployments match this filter'}
        </p>
      </div>
    </div>;
  }

  return (
    <div className="flex flex-col h-full p-6 bg-bg-app">
      <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="divide-y divide-border/50 overflow-auto flex-1">
          {filteredDeployments.map((deploy) => {
            const statusMeta = getDeploymentStatusMeta(deploy.status);
            const shortCommitSha = getShortCommitSha(deploy.commitSha);
            const triggerIconName = getDeploymentTriggerIcon(deploy.trigger);

            const TriggerIcon =
              triggerIconName === 'Bot'
                ? Bot
                : triggerIconName === 'Webhook'
                  ? Webhook
                  : triggerIconName === 'Zap'
                    ? Zap
                    : Rocket;

            return (
              <div
                key={deploy.id}
                onClick={() => navigate(`/projects/${projectId}/deployments/${deploy.id}`)}
                className={cn(
                  'flex items-center gap-3 py-2.5 px-4 cursor-pointer transition-colors hover:bg-bg-subtle/50',
                  deploy.trigger === 'chat' && 'ai-deploy-border',
                )}
              >
                <div className={cn('h-2 w-2 rounded-full shrink-0', statusMeta.dotClass)} />

                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground truncate shrink-0">
                  <TriggerIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {getDeploymentTriggerLabel(deploy.trigger, deploy.triggerDetail)}
                </span>
                <span className={cn('text-xs font-body shrink-0', statusMeta.textClass)}>
                  {statusMeta.label}
                </span>
                {shortCommitSha && (
                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                    {shortCommitSha}
                  </span>
                )}

                {deploy.failureSummary && (
                  <span className="text-xs font-body text-error truncate min-w-0">
                    {deploy.failureSummary}
                  </span>
                )}

                <div className="flex-1" />

                <div className="flex items-center gap-3 text-xs font-body text-muted-foreground shrink-0">
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
                  <span className="flex items-center gap-1 whitespace-nowrap justify-end">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(deploy.createdAt, t)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
