import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useAppLayout } from '@/components/layout/AppLayout';
import { getProject, redeployProject, stopProject } from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { TimelineFeed } from '@/components/timeline/TimelineFeed';
import { LogViewer } from '@/components/logs/LogViewer';
import { EnvVarsTable } from '@/components/config/EnvVarsTable';
import { DomainsPanel } from '@/components/config/DomainsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Project } from '@/types';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
  running: {
    label: 'Live',
    color: 'text-success',
    dot: 'bg-success shadow-[0_0_6px_var(--color-success)]',
  },
  stopped: {
    label: 'Stopped',
    color: 'text-muted-ol',
    dot: 'bg-[var(--text-muted)]',
  },
  building: {
    label: 'Deploying',
    color: 'text-warning',
    dot: 'bg-warning shadow-[0_0_6px_var(--color-warning)] animate-pulse',
  },
  error: {
    label: 'Failed',
    color: 'text-error',
    dot: 'bg-error shadow-[0_0_6px_var(--color-error)]',
  },
};

export function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { openChatWithPrompt } = useAppLayout();
  const isMobile = useIsMobile();
  const { items, isStreaming, submitAnswer, skipQuestion, executeAction } = useTimeline({
    projectId: id,
    enabled: !!id,
  });

  const handleFixWithAI = useCallback(
    (errorMsg?: string) => {
      openChatWithPrompt(
        errorMsg
          ? `Fix this deployment error: ${errorMsg}`
          : 'Help me fix the deployment error for this project',
      );
    },
    [openChatWithPrompt],
  );

  // Fetch project details
  useEffect(() => {
    if (!id) return;
    const fetchProject = async () => {
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
    const interval = setInterval(fetchProject, 5000);
    return () => clearInterval(interval);
  }, [id]);

  const handleRedeploy = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('redeploy');
    try {
      await redeployProject(id);
      // Refresh project data after redeploy
      const data = await getProject(id);
      setProject(data);
    } catch (err) {
      console.error('Redeploy failed:', err);
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
          </div>
        </div>
      </div>

      {/* Tabs: Timeline / Logs */}
      <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10">
          <TabsTrigger
            value="timeline"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Activity className="h-3.5 w-3.5" />
            Timeline
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

        <TabsContent value="timeline" className="flex-1 min-h-0 mt-0">
          <TimelineFeed
            items={items}
            isStreaming={isStreaming}
            onSubmitAnswer={submitAnswer}
            onSkipQuestion={skipQuestion}
            onInsightAction={executeAction}
            onFixWithAI={handleFixWithAI}
          />
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
