import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/i18n/context';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  getProject,
  redeployProject,
  startProject,
  stopProject,
  rollbackProject,
  blueGreenProject,
  debugBuild,
  type BuildDiagnosis,
  type PostmortemData,
} from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { TimelineFeed } from '@/components/timeline/TimelineFeed';
import { PostmortemCard } from '@/components/timeline/PostmortemCard';
import { LogViewer } from '@/components/logs/LogViewer';
import { LogPreview } from '@/components/timeline/LogPreview';
import { EnvVarsTable } from '@/components/config/EnvVarsTable';
import { DomainsPanel } from '@/components/config/DomainsPanel';
import { WebhookPanel } from '@/components/config/WebhookPanel';
import { DeploymentsList } from '@/components/project/DeploymentsList';
import { PRPreviewsList } from '@/components/timeline/PRPreviewsList';
import { ShareDialog } from '@/components/sidebar/ShareDialog';
import { AssistantPanel } from '@/components/assistant/AssistantPanel';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';
import { useAssistant } from '@/hooks/use-assistant';
import {
  ExternalLink,
  RotateCw,
  Play,
  Square,
  GitBranch,
  Activity,
  ScrollText,
  Settings,
  Globe,
  Share2,
  GlobeLock,
  GitPullRequest,
  History,
  Zap,
  Brain,
  SquareTerminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/lib/event-types';

function getStatusConfig(
  _t: (key: string) => string,
): Record<string, { label: string; color: string; dot: string }> {
  return {
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
}

function formatBuildDiagnosisDetail(diagnosis: BuildDiagnosis, t: (key: string) => string): string {
  const lines = ['Root cause:' + '\n' + diagnosis.rootCause, ''];

  if (diagnosis.suggestedFixes.length > 0) {
    lines.push('Suggested fixes:');
    diagnosis.suggestedFixes.forEach((fix, index) => {
      const location = fix.location ? ' (' + fix.location + ')' : '';
      lines.push(String(index + 1) + '. [' + fix.confidence + '] ' + fix.description + location);
    });
  } else {
    lines.push(t('projectDetail.diagnosis.noFixes'));
  }

  if (diagnosis.rawAnalysis.trim()) {
    lines.push('', 'Raw analysis:' + '\n' + diagnosis.rawAnalysis);
  }

  return lines.join('\n');
}

export function ProjectDetail() {
  const { id } = useParams();
  const { t } = useLanguage();
  const statusConfig = getStatusConfig(t);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('timeline');
  const [timelineRunKey, setTimelineRunKey] = useState(0);
  const [fixWithAIItems, setFixWithAIItems] = useState<TimelineItem[]>([]);
  const [fixingItemId, setFixingItemId] = useState<string | null>(null);
  const [postmortem, setPostmortem] = useState<PostmortemData | null>(null);
  const isMobile = useIsMobile();
  const [shareOpen, setShareOpen] = useState(false);
  const assistant = useAssistant(id);

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

  useEffect(() => {
    if (!id || (project?.status !== 'running' && project?.status !== 'error')) {
      return;
    }

    const controller = new AbortController();

    const fetchPostmortem = async () => {
      try {
        const res = await fetch(`/api/projects/${id}/postmortem/latest`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setPostmortem(null);
          return;
        }
        const data = (await res.json()) as PostmortemData;
        setPostmortem(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setPostmortem(null);
      }
    };

    void fetchPostmortem();

    return () => {
      controller.abort();
    };
  }, [id, project?.status]);

  const { items, isStreaming, submitAnswer, skipQuestion, executeAction } = useTimeline({
    projectId: id,
    enabled: !!id,
    runKey: timelineRunKey,
    onSettled: fetchProject,
    onRawEvent: assistant.addDeployEvent,
  });

  const allTimelineItems = useMemo(() => [...items, ...fixWithAIItems], [items, fixWithAIItems]);

  useEffect(() => {
    setFixWithAIItems([]);
    setFixingItemId(null);
  }, [id, timelineRunKey]);

  const handleFixWithAI = async (_errorMessage?: string, timelineItemId?: string) => {
    if (!id || fixingItemId) return;

    const sourceItemId = timelineItemId ?? 'manual-' + Date.now();
    setFixingItemId(sourceItemId);

    try {
      const diagnosis = await debugBuild(id);
      setFixWithAIItems((prev) => [
        ...prev,
        {
          id: 'ai-fix-' + sourceItemId + '-' + Date.now(),
          type: 'insight',
          timestamp: new Date().toISOString(),
          title: 'AI diagnosis:' + ' ' + diagnosis.summary,
          detail: formatBuildDiagnosisDetail(diagnosis, t),
          percent: -1,
          severity: 'warning',
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze build failure';
      setFixWithAIItems((prev) => [
        ...prev,
        {
          id: 'ai-fix-' + sourceItemId + '-' + Date.now() + '-error',
          type: 'insight',
          timestamp: new Date().toISOString(),
          title: t('projectDetail.diagnosis.fixFailed'),
          detail: message,
          percent: -1,
          severity: 'error',
        },
      ]);
      console.error('Fix with AI failed:', err);
    } finally {
      setFixingItemId(null);
    }
  };

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
      await redeployProject(id);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project redeploying');
    } catch (err) {
      console.error('Redeploy failed:', err);
      toast.error('Redeploy failed: ' + (err instanceof Error ? err.message : String(err)));
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
      toast.success('Project stopped');
    } catch (err) {
      console.error('Stop failed:', err);
      toast.error('Stop failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('start');
    try {
      await startProject(id);
      await fetchProject();
      toast.success('Project started');
    } catch (err) {
      console.error('Start failed:', err);
      toast.error('Start failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    if (!project?.previousImageTag) return;

    setActionLoading('rollback');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));

    try {
      await rollbackProject(id);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project rolling back');
    } catch (err) {
      console.error('Rollback failed:', err);
      toast.error('Rollback failed: ' + (err instanceof Error ? err.message : String(err)));
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

  const handleBlueGreen = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('bluegreen');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
    try {
      await blueGreenProject(id);
      setTimelineRunKey((k) => k + 1);
      toast.success('Blue-green deploy started');
    } catch (err) {
      console.error('Blue-green deploy failed:', err);
      toast.error(
        'Blue-green deploy failed: ' + (err instanceof Error ? err.message : String(err)),
      );
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        /* silent */
      }
    } finally {
      setActionLoading(null);
    }
  };
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-3 rounded-full" />
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-10 w-full max-w-md mb-4" />
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm font-body text-secondary-ol">{t('projectDetail.notFound')}</p>
      </div>
    );
  }

  const status = statusConfig[project.status] ?? statusConfig.stopped;

  return (
    <>
      <div className="flex flex-row h-full">
        <div className="flex flex-col flex-1 min-w-0 h-full">
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
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <RotateCw className="h-3 w-3" />
                  )}
                  {'Redeploy'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] font-body gap-1.5 text-agent hover:text-agent hover:bg-agent/10 hover:border-agent/30"
                  onClick={handleRollback}
                  disabled={!project.previousImageTag || !!actionLoading}
                >
                  {actionLoading === 'rollback' ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <History className="h-3 w-3" />
                  )}
                  {'Rollback'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] font-body gap-1.5 text-success hover:text-success hover:bg-success/10 hover:border-success/30"
                  onClick={handleBlueGreen}
                  disabled={project.status !== 'running' || !!actionLoading}
                >
                  {actionLoading === 'bluegreen' ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <Zap className="h-3 w-3" />
                  )}
                  Blue-Green
                </Button>
                {project.status === 'stopped' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] font-body gap-1.5 text-success hover:text-success hover:bg-success/10 hover:border-success/30"
                    onClick={handleStart}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === 'start' ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    {'Start'}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] font-body gap-1.5 text-error hover:text-error hover:bg-error/10 hover:border-error/30"
                    onClick={handleStop}
                    disabled={!!actionLoading}
                  >
                    {actionLoading === 'stop' ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <Square className="h-3 w-3" />
                    )}
                    {'Stop'}
                  </Button>
                )}
                <Button
                  variant={assistant.isOpen ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'h-7 text-[11px] font-body gap-1.5',
                    assistant.isOpen && 'bg-agent text-bg-app hover:bg-agent/90',
                  )}
                  onClick={assistant.togglePanel}
                >
                  <Brain className="h-3 w-3" />
                  {'AI Assistant'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-7 text-[11px] font-body gap-1.5',
                    project.visibility === 'shared' || project.visibility === 'quick-share'
                      ? 'text-agent hover:text-agent hover:bg-agent/10 hover:border-agent/30'
                      : '',
                  )}
                  onClick={() => setShareOpen(true)}
                  disabled={project.status !== 'running' || !!actionLoading}
                >
                  {project.visibility === 'shared' || project.visibility === 'quick-share' ? (
                    <GlobeLock className="h-3 w-3" />
                  ) : (
                    <Share2 className="h-3 w-3" />
                  )}
                  {project.visibility === 'shared'
                    ? 'Shared'
                    : project.visibility === 'quick-share'
                      ? 'Exposed'
                      : 'Share'}
                </Button>
              </div>
            </div>
          </div>

          {/* Tabs: Timeline / Logs / Config */}
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col min-h-0"
          >
            <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10">
              <TabsTrigger
                value="timeline"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <Activity className="h-3.5 w-3.5" />
                {'Timeline'}
              </TabsTrigger>
              <TabsTrigger
                value="deployments"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <History className="h-3.5 w-3.5" />
                {'Deployments'}
              </TabsTrigger>
              <TabsTrigger
                value="previews"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <GitPullRequest className="h-3.5 w-3.5" />
                {'Previews'}
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <ScrollText className="h-3.5 w-3.5" />
                {'Logs'}
              </TabsTrigger>
              <TabsTrigger
                value="terminal"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <SquareTerminal className="h-3.5 w-3.5" />
                {'Terminal'}
              </TabsTrigger>
              <TabsTrigger
                value="config"
                className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
              >
                <Settings className="h-3.5 w-3.5" />
                {'Configuration'}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="timeline" className="flex-1 min-h-0 mt-0 overflow-auto p-4">
              <div className="space-y-4">
                {postmortem && (
                  <PostmortemCard
                    projectId={postmortem.projectId}
                    projectName={postmortem.projectName}
                    markdown={postmortem.markdown}
                    generatedAt={postmortem.generatedAt}
                  />
                )}
                <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden flex flex-col h-[600px]">
                  <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center gap-2 text-xs font-body text-primary-ol shrink-0 bg-bg-panel/50">
                    <Activity className="h-3.5 w-3.5" />
                    {'Deployment timeline'}
                  </div>
                  <div className="flex-1 min-h-0">
                    <TimelineFeed
                      items={allTimelineItems}
                      isStreaming={isStreaming}
                      projectStatus={project.status}
                      onSubmitAnswer={submitAnswer}
                      onSkipQuestion={skipQuestion}
                      onInsightAction={executeAction}
                      onFixWithAI={handleFixWithAI}
                      fixingItemId={fixingItemId}
                    />
                  </div>
                </section>

                {id && project && (
                  <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
                    <div className="px-4 py-3 border-b border-[hsl(var(--border))] flex items-center gap-2 text-xs font-body text-primary-ol">
                      <ScrollText className="h-3.5 w-3.5" />
                      {'Build logs'}
                    </div>
                    <LogPreview
                      projectId={id}
                      status={project.status}
                      onOpenLogs={() => setActiveTab('logs')}
                    />
                  </section>
                )}
              </div>
            </TabsContent>
            <TabsContent value="deployments" className="flex-1 min-h-0 mt-0">
              {id && <DeploymentsList projectId={id} projectStatus={project?.status} />}
            </TabsContent>

            <TabsContent value="previews" className="flex-1 min-h-0 mt-0">
              {id && <PRPreviewsList projectId={id} />}
            </TabsContent>

            <TabsContent value="logs" className="flex-1 min-h-0 mt-0 relative">
              {id && <LogViewer projectId={id} />}
            </TabsContent>

            <TabsContent value="terminal" className="flex-1 min-h-0 mt-0 p-4">
              {id && activeTab === 'terminal' && (
                <TerminalPanel projectId={id} isActive={project.status === 'running'} />
              )}
            </TabsContent>

            <TabsContent value="config" className="flex-1 min-h-0 mt-0 overflow-auto">
              {id && (
                <Tabs defaultValue="env" className="p-4">
                  <TabsList className="bg-bg-subtle">
                    <TabsTrigger value="env" className="text-xs font-body">
                      {'Environment Variables'}
                    </TabsTrigger>
                    <TabsTrigger value="domains" className="text-xs font-body">
                      {'Domains'}
                    </TabsTrigger>
                    <TabsTrigger value="webhooks" className="text-xs font-body">
                      {'Webhooks'}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="env">
                    <EnvVarsTable projectId={id} />
                  </TabsContent>
                  <TabsContent value="domains">
                    <DomainsPanel projectId={id} projectStatus={project?.status} />
                  </TabsContent>
                  <TabsContent value="webhooks">
                    <WebhookPanel projectId={id} />
                  </TabsContent>
                </Tabs>
              )}
            </TabsContent>
          </Tabs>
        </div>
        {id && (
          <AssistantPanel
            projectId={id}
            isOpen={assistant.isOpen}
            onToggle={assistant.togglePanel}
            items={assistant.items}
            isStreaming={assistant.isStreaming}
            onSendMessage={assistant.sendMessage}
          />
        )}
      </div>
      <ShareDialog
        projectId={id!}
        projectName={project.name}
        isRunning={project.status === 'running'}
        visibility={project.visibility}
        publicUrl={project.publicUrl ?? null}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onShareChange={fetchProject}
      />
    </>
  );
}
