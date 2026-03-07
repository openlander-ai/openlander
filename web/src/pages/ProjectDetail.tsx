import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  getProject,
  redeployProject,
  stopProject,
  exposeProject,
  unexposeProject,
  getProjectDeployments,
} from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { TimelineFeed } from '@/components/timeline/TimelineFeed';
import { LogViewer } from '@/components/logs/LogViewer';
import { LogPreview } from '@/components/timeline/LogPreview';
import { EnvVarsTable } from '@/components/config/EnvVarsTable';
import { DomainsPanel } from '@/components/config/DomainsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Project, DeployLogSummary } from '@/types';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  RotateCw,
  Square,
  Loader2,
  GitBranch,
  Activity,
  ScrollText,
  Settings,
  Globe,
  GlobeLock,
  History,
  Clock,
  GitCommit,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  running: {
    label: 'Live',
    color: 'text-success',
    dot: 'bg-success',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-muted-ol',
    dot: 'bg-[var(--text-muted)]',
  },
  building: {
    label: 'Deploying',
    color: 'text-warning',
    dot: 'bg-warning animate-pulse',
  },
  error: {
    label: 'Failed',
    color: 'text-error',
    dot: 'bg-error',
  },
};
function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function DeploymentsList({ projectId }: { projectId: string }) {
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
    fetchDeployments();
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-agent" />
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-secondary-ol">
        <History className="h-8 w-8 mb-3 text-muted-ol" />
        <p className="text-sm font-body">No deployments yet</p>
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
                    {deploy.trigger} Deployment
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
                    {formatRelativeTime(deploy.createdAt)}
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

export function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('timeline');
  const [timelineRunKey, setTimelineRunKey] = useState(0);
  const isMobile = useIsMobile();

  // Fetch project details
  const fetchProject = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getProject(id);
      setProject(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
    const interval = setInterval(fetchProject, 5000);
    return () => clearInterval(interval);
  }, [fetchProject]);

  const { items, isStreaming, submitAnswer, skipQuestion, executeAction } = useTimeline({
    projectId: id,
    enabled: !!id,
    runKey: timelineRunKey,
    onSettled: fetchProject,
  });

  const handleRedeploy = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('redeploy');

    // Optimistic UI: immediately show building state + reset timeline
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));

    try {
      // Fire redeploy (server immediately sets DB status to 'building')
      await redeployProject(id);
      // Reset timeline to reconnect build stream (DB is now 'building')
      setTimelineRunKey((k) => k + 1);
    } catch (err) {
      console.error('Redeploy failed:', err);
      // Rollback: fetch actual project state on failure
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        // silent
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('stop');
    try {
      await stopProject(id);
    } catch (err) {
      console.error('Stop failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExpose = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('expose');
    try {
      if (project?.publicUrl) {
        await unexposeProject(id);
        setProject((prev) => (prev ? { ...prev, publicUrl: null } : prev));
      } else {
        const { publicUrl } = await exposeProject(id);
        setProject((prev) => (prev ? { ...prev, publicUrl } : prev));
      }
    } catch (err) {
      console.error('Expose/unexpose failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm font-body text-secondary-ol">Project not found</p>
      </div>
    );
  }

  const status = statusConfig[project.status] ?? statusConfig.stopped;

  return (
    <div className="flex flex-col h-full">
      {/* Project Header */}
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
            <div className="min-w-0">
              <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
                {project.name}
              </h1>
              <div className="flex items-center gap-3 mt-0.5 text-[11px] font-body text-secondary-ol">
                <span className={status.color}>{status.label}</span>
                {project.branch && (
                  <span className="flex items-center gap-1 text-muted-ol">
                    <GitBranch className="h-3 w-3" />
                    {project.branch}
                  </span>
                )}
                {project.url && (
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-agent hover:text-agent/80 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {project.url.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
              {project.publicUrl && (
                <a
                  href={project.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-success hover:text-success/80 transition-colors"
                >
                  <Globe className="h-3 w-3" />
                  {project.publicUrl.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] font-body gap-1.5"
              onClick={handleRedeploy}
              disabled={!!actionLoading}
            >
              {actionLoading === 'redeploy' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCw className="h-3 w-3" />
              )}
              Redeploy
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] font-body gap-1.5 text-error hover:text-error hover:bg-error/10 hover:border-error/30"
              onClick={handleStop}
              disabled={project.status === 'stopped' || !!actionLoading}
            >
              {actionLoading === 'stop' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              Stop
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-7 text-[11px] font-body gap-1.5',
                project.publicUrl
                  ? 'text-agent hover:text-agent hover:bg-agent/10 hover:border-agent/30'
                  : '',
              )}
              onClick={handleExpose}
              disabled={project.status !== 'running' || !!actionLoading}
            >
              {actionLoading === 'expose' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : project.publicUrl ? (
                <GlobeLock className="h-3 w-3" />
              ) : (
                <Globe className="h-3 w-3" />
              )}
              {project.publicUrl ? 'Unexpose' : 'Expose'}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs: Timeline / Logs / Config */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10">
          <TabsTrigger
            value="timeline"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Activity className="h-3.5 w-3.5" />
            Timeline
          </TabsTrigger>
          <TabsTrigger
            value="deployments"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <History className="h-3.5 w-3.5" />
            Deployments
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Logs
          </TabsTrigger>
          <TabsTrigger
            value="config"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Settings className="h-3.5 w-3.5" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="flex-1 min-h-0 mt-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <TimelineFeed
              items={items}
              isStreaming={isStreaming}
              onSubmitAnswer={submitAnswer}
              onSkipQuestion={skipQuestion}
              onInsightAction={executeAction}
            />
          </div>
          {id && project && (
            <LogPreview
              projectId={id}
              status={project.status}
              onOpenLogs={() => setActiveTab('logs')}
            />
          )}
        </TabsContent>

        <TabsContent value="deployments" className="flex-1 min-h-0 mt-0">
          {id && <DeploymentsList projectId={id} />}
        </TabsContent>

        <TabsContent value="logs" className="flex-1 min-h-0 mt-0 relative">
          {id && <LogViewer projectId={id} />}
        </TabsContent>

        <TabsContent value="config" className="flex-1 min-h-0 mt-0 overflow-auto">
          {id && (
            <Tabs defaultValue="env" className="p-4">
              <TabsList className="bg-bg-subtle">
                <TabsTrigger value="env" className="text-xs font-body">
                  Environment Variables
                </TabsTrigger>
                <TabsTrigger value="domains" className="text-xs font-body">
                  Domains
                </TabsTrigger>
              </TabsList>
              <TabsContent value="env">
                <EnvVarsTable projectId={id} />
              </TabsContent>
              <TabsContent value="domains">
                <DomainsPanel projectId={id} />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
