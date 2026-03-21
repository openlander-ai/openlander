import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Activity, ExternalLink, Globe, Clock } from 'lucide-react';
import { getProjectDeployments } from '@/lib/api';
import { formatTime, formatRelativeTime } from '@/lib/time';
import type { DeployLogSummary } from '@/types';
import type { TimelineItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';

interface SummaryDashboardProps {
  projectId: string;
  project: {
    status: string;
    url?: string;
    publicUrl?: string | null;
    port?: number;
  };
  recentEvents: TimelineItem[];
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(): Record<string, StatusConfig> {
  return {
    running: { label: 'Live', color: 'text-success', dot: 'bg-success' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    building: { label: 'Deploying', color: 'text-warning', dot: 'bg-warning animate-pulse' },
    error: { label: 'Failed', color: 'text-error', dot: 'bg-error' },
  };
}

export function SummaryDashboard({ projectId, project, recentEvents }: SummaryDashboardProps) {
  const [latestDeploy, setLatestDeploy] = useState<DeployLogSummary | null>(null);
  const [loadingDeploy, setLoadingDeploy] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchDeployments() {
      try {
        const deployments = await getProjectDeployments(projectId, 1);
        if (mounted && deployments.length > 0) {
          setLatestDeploy(deployments[0]);
        }
      } catch (error) {
        console.error('Failed to fetch deployments:', error);
      } finally {
        if (mounted) {
          setLoadingDeploy(false);
        }
      }
    }
    void fetchDeployments();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const statusConfig = getStatusConfig();
  const status = statusConfig[project.status] ?? statusConfig.stopped;

  const last5Events = recentEvents.slice(-5).reverse();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Card 1: Status+URL */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3">Status</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.dot)} />
            <span className={cn('text-sm font-body', status.color)}>{status.label}</span>
          </div>

          {project.url && (
            <div className="flex items-center gap-2 text-sm font-body">
              <span className="text-muted-ol w-16">Internal:</span>
              <a
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-agent hover:text-agent/80 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {project.url.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}

          {project.publicUrl && (
            <div className="flex items-center gap-2 text-sm font-body">
              <span className="text-muted-ol w-16">Public:</span>
              <a
                href={project.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-success hover:text-success/80 transition-colors"
              >
                <Globe className="h-3.5 w-3.5" />
                {project.publicUrl.replace(/^https?:\/\//, '')}
              </a>
            </div>
          )}

          {project.port !== undefined && (
            <div className="flex items-center gap-2 text-sm font-body">
              <span className="text-muted-ol w-16">Port:</span>
              <span className="text-secondary-ol">{project.port}</span>
            </div>
          )}
        </div>
      </div>

      {/* Card 2: Latest Deploy */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3">Latest Deploy</h3>
        {loadingDeploy ? (
          <div className="text-sm text-muted-ol font-body">Loading...</div>
        ) : latestDeploy ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-ol" />
                <span className="text-sm font-body text-secondary-ol">
                  {formatRelativeTime(latestDeploy.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {latestDeploy.status === 'success' && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-body bg-success/10 text-success border border-success/20">
                    Success
                  </span>
                )}
                {latestDeploy.status === 'failed' && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-body bg-error/10 text-error border border-error/20">
                    Failed
                  </span>
                )}
                {latestDeploy.status === 'cancelled' && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-body bg-warning/10 text-warning border border-warning/20">
                    Cancelled
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm font-body mt-1">
              {latestDeploy.commitSha && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-ol">Commit:</span>
                  <span className="font-mono text-secondary-ol">
                    {latestDeploy.commitSha.substring(0, 7)}
                  </span>
                </div>
              )}
              {latestDeploy.durationMs !== null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-ol">Duration:</span>
                  <span className="text-secondary-ol">
                    {(latestDeploy.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-ol font-body">No deployments yet</div>
        )}
      </div>

      {/* Card 3: Recent Events */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3">Recent Events</h3>
        {recentEvents.length > 0 ? (
          <div className="flex flex-col gap-2">
            {last5Events.map((event) => {
              const isSuccess = event.type === 'success';
              const isError = event.type === 'error';

              return (
                <div key={event.id} className="flex items-start gap-2">
                  <div className="shrink-0 mt-0.5">
                    {isSuccess ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    ) : isError ? (
                      <AlertCircle className="h-3.5 w-3.5 text-error" />
                    ) : (
                      <Activity className="h-3.5 w-3.5 text-agent" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="text-sm font-body text-secondary-ol truncate">
                      {event.title}
                    </span>
                    <span className="text-[10px] font-mono text-muted-ol shrink-0">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-muted-ol font-body">No recent events</div>
        )}
      </div>
    </div>
  );
}
