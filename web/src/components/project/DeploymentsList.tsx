import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import { getProjectDeployments } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { GitCommit, Clock, Activity, History } from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { DeployLogSummary } from '@/types';

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

interface DeploymentsListProps {
  projectId: string;
  projectStatus?: string;
}

export function DeploymentsList({ projectId, projectStatus }: DeploymentsListProps) {
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    const fetchDeployments = async () => {
      try {
        const data = await getProjectDeployments(projectId);
        setDeployments(data);
      } catch (err) {
        console.error('Failed to fetch deployments:', err);
      } finally {
        setLoading(false);
      }
    };
    void fetchDeployments();
  }, [projectId, projectStatus]);

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

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-secondary-ol">
        <History className="h-8 w-8 mb-3 text-muted-ol" />
        <p className="text-sm font-body">{t('projectDetail.noDeployments')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      {deployments.map((deploy) => {
        const statusColor =
          deploy.status === 'success'
            ? 'bg-success'
            : deploy.status === 'failed'
              ? 'bg-error'
              : 'bg-[var(--text-muted)]';

        return (
          <div
            key={deploy.id}
            onClick={() => navigate(`/projects/${projectId}/deployments/${deploy.id}`)}
            className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))] bg-bg-panel hover:border-agent/30 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusColor)} />
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-display font-medium text-primary-ol capitalize">
                    {deploy.trigger} {'Deployment'}
                  </span>
                  {deploy.commitSha && (
                    <span className="flex items-center gap-1 text-xs font-mono text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                      <GitCommit className="h-3 w-3" />
                      {deploy.commitSha.substring(0, 7)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs font-body text-secondary-ol">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(deploy.createdAt, t)}
                  </span>
                  {deploy.durationMs && (
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {formatDuration(deploy.durationMs)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
