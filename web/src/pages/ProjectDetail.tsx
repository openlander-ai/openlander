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
  getProjectDeployments,
  debugBuild,
  getProjectWebhooks,
  setProjectWebhook,
  deleteProjectWebhook,
  type BuildDiagnosis,
  type WebhookConfig,
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
import { PRPreviewsList } from '@/components/timeline/PRPreviewsList';
import { ShareDialog } from '@/components/sidebar/ShareDialog';
import { formatRelativeTime } from '@/lib/time';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Project, DeployLogSummary } from '@/types';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  RotateCw,
  Play,
  Square,
  Loader2,
  GitBranch,
  Activity,
  ScrollText,
  Settings,
  Globe,
  Share2,
  GlobeLock,
  GitPullRequest,
  History,
  Clock,
  GitCommit,
  Zap,
  Webhook,
  Copy,
  Check,
  Trash2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimelineItem } from '@/lib/event-types';
import { useNavigate } from 'react-router-dom';

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

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function DeploymentsList({
  projectId,
  projectStatus,
}: {
  projectId: string;
  projectStatus?: string;
}) {
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
    fetchDeployments();
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

function WebhookPanel({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('github');
  const [branchFilter, setBranchFilter] = useState('main');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await getProjectWebhooks(projectId);
      setWebhooks(data);
    } catch (err) {
      console.error('Failed to fetch webhooks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchWebhooks();
  }, [fetchWebhooks]);

  const handleAdd = async () => {
    try {
      setAdding(true);
      await setProjectWebhook(projectId, {
        source: selectedSource,
        branch_filter: branchFilter,
        enabled: true,
      });
      await fetchWebhooks();
      setBranchFilter('main');
    } catch (err) {
      console.error('Failed to add webhook:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (webhook: WebhookConfig) => {
    try {
      await setProjectWebhook(projectId, {
        source: webhook.source,
        branch_filter: webhook.branchFilter,
        enabled: !webhook.enabled,
      });
      await fetchWebhooks();
    } catch (err) {
      console.error('Failed to toggle webhook:', err);
    }
  };

  const handleDelete = async (source: string) => {
    try {
      await deleteProjectWebhook(projectId, source);
      await fetchWebhooks();
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const configuredSources = new Set(webhooks.map((w) => w.source));
  const availableSources = (['github', 'gitlab', 'bitbucket'] as const).filter(
    (s) => !configuredSources.has(s),
  );

  useEffect(() => {
    if (
      availableSources.length > 0 &&
      !availableSources.includes(selectedSource as (typeof availableSources)[number])
    ) {
      setSelectedSource(availableSources[0]);
    }
  }, [availableSources, selectedSource]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-8" />
                </div>
              </div>
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {webhooks.length === 0 ? (
        <div className="text-center py-8 text-secondary-ol text-sm font-body">
          <Webhook className="h-8 w-8 mx-auto mb-3 text-muted-ol" />
          <p>{t('webhooks.noWebhooks')}</p>
          <p className="text-xs text-muted-ol mt-1">{t('webhooks.description')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => {
            const fullUrl = `${window.location.origin}${webhook.webhookUrl}`;
            return (
              <div
                key={webhook.id}
                className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-display font-medium text-primary-ol capitalize">
                      {webhook.source}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-body',
                        webhook.enabled
                          ? 'bg-success/10 text-success'
                          : 'bg-[var(--bg-subtle)] text-muted-ol',
                      )}
                    >
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] font-body"
                      onClick={() => handleToggle(webhook)}
                    >
                      {webhook.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px] font-body text-error hover:text-error"
                      onClick={() => handleDelete(webhook.source)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 text-xs font-body">
                  <div>
                    <span className="text-muted-ol">{'Webhook URL'}:</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="flex-1 bg-bg-subtle px-2 py-1 rounded text-[11px] text-secondary-ol truncate">
                        {fullUrl}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0"
                        onClick={() => handleCopy(fullUrl, `url-${webhook.id}`)}
                      >
                        {copiedId === `url-${webhook.id}` ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div>
                    <span className="text-muted-ol">{'Secret'}:</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="flex-1 bg-bg-subtle px-2 py-1 rounded text-[11px] text-secondary-ol truncate">
                        {webhook.secret}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0"
                        onClick={() => handleCopy(webhook.secret, `secret-${webhook.id}`)}
                      >
                        {copiedId === `secret-${webhook.id}` ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-muted-ol">
                    <span>{'Branch filter'}:</span>
                    <span className="text-secondary-ol">{webhook.branchFilter}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {availableSources.length > 0 && (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-3">
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 text-xs font-body text-primary-ol capitalize"
            >
              {availableSources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              placeholder="main"
              className="h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 text-xs font-body text-primary-ol w-24"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-body gap-1.5"
              onClick={handleAdd}
              disabled={adding}
            >
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {'Add Webhook'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
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
