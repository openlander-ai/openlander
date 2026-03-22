import { useEffect, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { DeployTerminalSession } from '@/components/deploy-terminal/DeployTerminalSession';
import type { TimelineItem } from '@/lib/event-types';
import { getProjectDeployments } from '@/lib/api';
import type { Project, DeployLogSummary } from '@/types';
import { ExternalLink, Globe, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
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
        <div className="p-4 text-sm text-error bg-error/10 border border-error/20 rounded-lg">
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
}: OverviewTabProps) {
  const [latestDeploy, setLatestDeploy] = useState<DeployLogSummary | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Auto-expand pipeline during build or on failure
  useEffect(() => {
    if (projectStatus === 'building' || isTimelineStreaming) {
      setPipelineOpen(true);
    }
  }, [projectStatus, isTimelineStreaming]);

  // Fetch latest deploy
  useEffect(() => {
    let mounted = true;

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

  const activeProject = displayProject;
  const isBuilding = projectStatus === 'building' || isTimelineStreaming;

  const imageTag =
    (activeProject as Project & { image_tag?: string })?.image_tag ||
    (activeProject as Project & { environments?: { imageTag?: string }[] })?.environments?.[0]
      ?.imageTag ||
    activeProject?.previousImageTag;

  const lastEvent = timelineItems.length > 0 ? timelineItems[timelineItems.length - 1] : null;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-6 bg-bg-app">
      {/* Section 1: Key Info (flat, no cards) */}
      <section className="space-y-4 pb-6">
        {/* Endpoint */}
        {(activeProject?.publicUrl || activeProject?.url) && (
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-ol" />
            <a
              href={activeProject.publicUrl || activeProject.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-agent hover:underline"
            >
              {(activeProject.publicUrl || activeProject.url)?.replace(/^https?:\/\//, '')}
            </a>
            <ExternalLink className="h-3 w-3 text-muted-ol" />
          </div>
        )}

        {/* Latest Deploy */}
        {latestDeploy && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-ol">Latest Deploy</span>
              {latestDeploy.commitSha && (
                <span className="font-mono text-secondary-ol">
                  {latestDeploy.commitSha.substring(0, 7)}
                </span>
              )}
              <span className="text-muted-ol">{formatRelativeTime(latestDeploy.createdAt)}</span>
              {latestDeploy.durationMs && (
                <span className="text-muted-ol">
                  {(latestDeploy.durationMs / 1000).toFixed(0)}s
                </span>
              )}
            </div>
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium',
                latestDeploy.status === 'success' && 'bg-success/10 text-success',
                latestDeploy.status === 'failed' && 'bg-error/10 text-error',
                latestDeploy.status === 'cancelled' && 'bg-warning/10 text-warning',
              )}
            >
              {latestDeploy.status === 'success'
                ? '✓ Succeeded'
                : latestDeploy.status === 'failed'
                  ? 'Failed'
                  : 'Cancelled'}
            </span>
          </div>
        )}

        {/* Last event (1 line) */}
        {lastEvent && (
          <p className="text-xs text-muted-ol">
            Last event: {lastEvent.title} — {formatRelativeTime(lastEvent.timestamp)}
          </p>
        )}
      </section>

      {/* Section 2: Deploy Pipeline (collapsible) */}
      <section className="border-t border-border">
        <button
          onClick={() => setPipelineOpen(!pipelineOpen)}
          className="w-full flex items-center justify-between px-0 py-3 text-sm text-secondary-ol hover:text-primary-ol transition-colors"
        >
          <div className="flex items-center gap-2">
            {pipelineOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="font-medium">Deploy Pipeline</span>
          </div>
          <span className="text-xs text-muted-ol">
            {isBuilding ? 'Building...' : '✓ All stages completed'}
          </span>
        </button>
        {pipelineOpen && (
          <div
            className={cn(
              'rounded-lg border border-border bg-bg-terminal overflow-hidden mb-4',
              isBuilding ? 'min-h-[350px]' : 'max-h-[200px]',
            )}
          >
            <LocalErrorBoundary>
              <DeployTerminalSession
                projectName={activeProject?.name || projectId}
                branchName={activeProject?.branch}
                projectStatus={projectStatus}
                timelineItems={timelineItems}
                isTimelineStreaming={isTimelineStreaming}
              />
            </LocalErrorBoundary>
          </div>
        )}
      </section>

      {/* Section 3: Details (collapsible) */}
      <section className="border-t border-border">
        <button
          onClick={() => setDetailsOpen(!detailsOpen)}
          className="w-full flex items-center justify-between px-0 py-3 text-sm text-secondary-ol hover:text-primary-ol transition-colors"
        >
          <div className="flex items-center gap-2">
            {detailsOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="font-medium">Details</span>
          </div>
          <span className="text-xs text-muted-ol font-mono">
            {[
              activeProject?.port && `Port: ${activeProject.port}`,
              activeProject?.branch && activeProject.branch,
            ]
              .filter(Boolean)
              .join(' • ')}
          </span>
        </button>
        {detailsOpen && (
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 pb-4 text-sm">
            {activeProject?.port !== undefined && (
              <div>
                <span className="text-xs text-muted-ol block">Port</span>
                <span className="text-secondary-ol">{activeProject.port}</span>
              </div>
            )}
            {activeProject?.branch && (
              <div>
                <span className="text-xs text-muted-ol block">Branch</span>
                <span className="text-secondary-ol flex items-center gap-1">
                  <GitBranch className="h-3.5 w-3.5" />
                  {activeProject.branch}
                </span>
              </div>
            )}
            {imageTag && (
              <div>
                <span className="text-xs text-muted-ol block">Image</span>
                <span className="text-xs font-mono text-secondary-ol">{imageTag}</span>
              </div>
            )}
            {(
              activeProject as Project & {
                environments?: { id: string; type: string }[];
              }
            )?.environments &&
              ((
                activeProject as Project & {
                  environments?: { id: string; type: string }[];
                }
              ).environments?.length ?? 0) > 0 && (
                <div>
                  <span className="text-xs text-muted-ol block">Environments</span>
                  <div className="flex gap-2">
                    {(
                      activeProject as Project & {
                        environments?: { id: string; type: string }[];
                      }
                    ).environments?.map((env) => (
                      <span key={env.id} className="text-xs">
                        {env.type === 'production' ? 'prod' : env.type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </section>
    </div>
  );
}
