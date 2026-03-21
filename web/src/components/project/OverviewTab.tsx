import { useEffect, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { LogPreview } from '@/components/timeline/LogPreview';
import { DeployTerminalSession } from '@/components/deploy-terminal/DeployTerminalSession';
import type { TimelineItem } from '@/lib/event-types';
import { SummaryDashboard } from '@/components/project/SummaryDashboard';
import { getProject, getProjectDeployments } from '@/lib/api';
import type { Project, DeployLogSummary } from '@/types';
import {
  ExternalLink,
  Container,
  Globe,
  GitBranch,
  Clock,
  RotateCw,
  Square,
  Undo2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

class LocalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DeployTerminalSession Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-error bg-error/10 border border-error/20 rounded-lg m-4">
          Failed to load deploy terminal. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

interface OverviewTabProps {
  projectId: string;
  projectStatus: string;
  displayProject?: Project;
  // Timeline props
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  onOpenLogs: () => void;
  onRedeploy?: () => void;
  onStop?: () => void;
  onRollback?: () => void;
}

export function OverviewTab({
  projectId,
  projectStatus,
  displayProject,
  timelineItems,
  isTimelineStreaming,
  onOpenLogs,
  onRedeploy,
  onStop,
  onRollback,
}: OverviewTabProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [latestDeploy, setLatestDeploy] = useState<DeployLogSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    getProject(projectId)
      .then((data) => {
        if (mounted) setProject(data);
      })
      .catch((err) => console.error('Failed to fetch project:', err));

    getProjectDeployments(projectId, 1)
      .then((deployments) => {
        if (mounted && deployments.length > 0) {
          setLatestDeploy(deployments[0]);
        }
      })
      .catch((err) => console.error('Failed to fetch deployments:', err));

    return () => {
      mounted = false;
    };
  }, [projectId]);

  const activeProject = displayProject || project;
  const projectName = activeProject?.name || projectId;
  const branchName = activeProject?.branch;
  const publicUrl = activeProject?.publicUrl;
  const internalUrl = activeProject?.url;
  const port = activeProject?.port;
  const imageTag =
    (activeProject as Project & { image_tag?: string })?.image_tag ||
    (activeProject as Project & { environments?: { imageTag?: string }[] })?.environments?.[0]
      ?.imageTag ||
    activeProject?.previousImageTag;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-success';
      case 'error':
        return 'bg-error';
      case 'building':
        return 'bg-warning animate-pulse';
      default:
        return 'bg-muted-ol';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'running':
        return 'Running (healthy)';
      case 'error':
        return 'Error';
      case 'building':
        return 'Deploying';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Idle';
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-6 space-y-6 bg-bg-app">
      <section className="shrink-0">
        <SummaryDashboard
          projectId={projectId}
          project={
            activeProject ? { ...activeProject, status: projectStatus } : { status: projectStatus }
          }
          recentEvents={timelineItems}
        />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 flex-1 min-h-0">
        {/* Left Column: Deploy Timeline */}
        <section className="lg:col-span-3 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden shadow-sm min-h-[600px]">
          <LocalErrorBoundary>
            <DeployTerminalSession
              projectName={projectName}
              branchName={branchName}
              projectStatus={projectStatus}
              timelineItems={timelineItems}
              isTimelineStreaming={isTimelineStreaming}
            />
          </LocalErrorBoundary>
        </section>

        {/* Right Column: Infrastructure Info & Quick Actions */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Infrastructure Info Card */}
          <section className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 shadow-sm">
            <h3 className="text-sm font-display font-medium text-primary-ol mb-4 flex items-center gap-2">
              <Container className="h-4 w-4 text-muted-ol" />
              Infrastructure Info
            </h3>

            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-ol">Container Status</span>
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'h-2.5 w-2.5 rounded-full shrink-0',
                      getStatusColor(projectStatus),
                    )}
                  />
                  <span className="text-sm font-medium text-secondary-ol">
                    {getStatusText(projectStatus)}
                  </span>
                </div>
              </div>

              {imageTag && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-ol">Image</span>
                  <span className="text-xs font-mono text-secondary-ol bg-bg-app px-2 py-1 rounded border border-[hsl(var(--border))] w-fit">
                    {imageTag}
                  </span>
                </div>
              )}

              {port !== undefined && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-ol">Port</span>
                  <span className="text-sm font-medium text-secondary-ol">{port}</span>
                </div>
              )}

              {(publicUrl || internalUrl) && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-ol">Endpoint</span>
                  <a
                    href={publicUrl || internalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-medium text-agent hover:text-agent/80 transition-colors w-fit"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {(publicUrl || internalUrl)?.replace(/^https?:\/\//, '')}
                    <ExternalLink className="h-3 w-3 ml-0.5" />
                  </a>
                </div>
              )}

              {branchName && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-ol">Branch</span>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-secondary-ol">
                    <GitBranch className="h-3.5 w-3.5 text-muted-ol" />
                    {branchName}
                  </div>
                </div>
              )}

              {latestDeploy && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-ol">Last Deploy</span>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-secondary-ol">
                    <Clock className="h-3.5 w-3.5 text-muted-ol" />
                    {formatRelativeTime(latestDeploy.createdAt)}
                    {latestDeploy.durationMs && (
                      <span className="text-muted-ol text-xs ml-1">
                        ({(latestDeploy.durationMs / 1000).toFixed(1)}s)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {(
                activeProject as Project & {
                  environments?: { id: string; status: string; type: string }[];
                }
              )?.environments &&
                ((
                  activeProject as Project & {
                    environments?: { id: string; status: string; type: string }[];
                  }
                ).environments?.length ?? 0) > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-ol">Environments</span>
                    <div className="flex items-center gap-3 text-sm font-medium text-secondary-ol">
                      {(
                        activeProject as Project & {
                          environments?: { id: string; status: string; type: string }[];
                        }
                      ).environments?.map((env) => (
                        <div key={env.id} className="flex items-center gap-1.5">
                          <div className={cn('h-2 w-2 rounded-full', getStatusColor(env.status))} />
                          {env.type === 'production' ? 'prod' : env.type}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </section>

          {/* Quick Actions Card */}
          <section className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 shadow-sm">
            <h3 className="text-sm font-display font-medium text-primary-ol mb-4">Quick Actions</h3>
            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                className="w-full justify-start text-secondary-ol hover:text-primary-ol hover:bg-bg-app border border-transparent hover:border-[hsl(var(--border))]"
                onClick={onRedeploy}
                disabled={!onRedeploy || projectStatus === 'building'}
              >
                <RotateCw className="h-4 w-4 mr-2 text-muted-ol" />
                Redeploy
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-secondary-ol hover:text-primary-ol hover:bg-bg-app border border-transparent hover:border-[hsl(var(--border))]"
                onClick={onStop}
                disabled={!onStop || projectStatus === 'stopped' || projectStatus === 'building'}
              >
                <Square className="h-4 w-4 mr-2 text-muted-ol" />
                Stop
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-secondary-ol hover:text-primary-ol hover:bg-bg-app border border-transparent hover:border-[hsl(var(--border))]"
                onClick={onRollback}
                disabled={
                  !onRollback || !activeProject?.previousImageTag || projectStatus === 'building'
                }
              >
                <Undo2 className="h-4 w-4 mr-2 text-muted-ol" />
                Rollback
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-secondary-ol hover:text-primary-ol hover:bg-bg-app border border-transparent hover:border-[hsl(var(--border))]"
                onClick={onOpenLogs}
              >
                <FileText className="h-4 w-4 mr-2 text-muted-ol" />
                View Logs
              </Button>
            </div>
          </section>
        </div>
      </div>

      {projectId && (
        <section className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden shadow-sm">
          <LogPreview projectId={projectId} status={projectStatus} onOpenLogs={onOpenLogs} />
        </section>
      )}
    </div>
  );
}
