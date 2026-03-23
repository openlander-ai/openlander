import { useEffect, useState, useMemo, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { DeployTerminalSession } from '@/components/deploy-terminal/DeployTerminalSession';
import type { TimelineItem } from '@/lib/event-types';
import { getProjectDeployments, getProjectEnv } from '@/lib/api';
import { getServices, type Service } from '@/lib/api/services';
import type { Project, DeployLogSummary } from '@/types';
import {
  ExternalLink,
  Globe,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Database,
  AlertCircle,
  CheckCircle2,
  Clock,
  Activity,
  Zap,
  Bot,
  Webhook,
  Rocket,
  SquareTerminal,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/time';
import { normalizeLogText } from '@/lib/ansi';
import { cn } from '@/lib/utils';
import {
  getDeploymentStatusMeta,
  getDeploymentTriggerIcon,
  getShortCommitSha,
  formatDeploymentDuration,
} from '@/lib/deployments';
import { parseStaticLogEntries, type LogEntry } from '@/hooks/use-log-stream';

// ── Error boundary for deploy terminal ──────────────────────────────────────

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

// ── Log level detection (shared with LogViewer) ─────────────────────────────

function detectLevel(line: string): 'error' | 'warn' | 'info' | 'debug' | 'plain' {
  const lower = normalizeLogText(line).toLowerCase();
  if (/\berror\b|\bfatal\b|\bpanic\b/.test(lower)) return 'error';
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\binfo\b/.test(lower)) return 'info';
  if (/\bdebug\b|\btrace\b/.test(lower)) return 'debug';
  return 'plain';
}

// ── Trigger icon resolver ───────────────────────────────────────────────────

function TriggerIcon({ trigger }: { trigger: DeployLogSummary['trigger'] }) {
  const iconName = getDeploymentTriggerIcon(trigger);
  const Icon =
    iconName === 'Bot' ? Bot : iconName === 'Webhook' ? Webhook : iconName === 'Zap' ? Zap : Rocket;
  return <Icon className="h-3.5 w-3.5 text-muted-ol shrink-0" />;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  projectId: string;
  projectStatus: string;
  displayProject?: Project;
  // Timeline props
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  onOpenLogs: () => void;
  onOpenDeployments: () => void;
  onOpenSettings: () => void;
  onRedeploy?: () => void;
  onStop?: () => void;
  onRollback?: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function OverviewTab({
  projectId,
  projectStatus,
  displayProject,
  timelineItems,
  isTimelineStreaming,
  onOpenLogs,
  onOpenDeployments,
  onOpenSettings,
}: OverviewTabProps) {
  const [latestDeploy, setLatestDeploy] = useState<DeployLogSummary | null>(null);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [recentDeploys, setRecentDeploys] = useState<DeployLogSummary[]>([]);
  const [connectedServices, setConnectedServices] = useState<Service[]>([]);
  const [envVarCount, setEnvVarCount] = useState<number>(0);
  const [errorEntries, setErrorEntries] = useState<LogEntry[]>([]);

  const activeProject = displayProject;
  const isBuilding = projectStatus === 'building' || isTimelineStreaming;
  const isRunning = projectStatus === 'running';

  const imageTag =
    (activeProject as Project & { image_tag?: string })?.image_tag ||
    (activeProject as Project & { environments?: { imageTag?: string }[] })?.environments?.[0]
      ?.imageTag ||
    activeProject?.previousImageTag;

  const lastEvent = timelineItems.length > 0 ? timelineItems[timelineItems.length - 1] : null;

  const uptime = useMemo(() => {
    if (!isRunning || !activeProject?.updatedAt) return null;
    const diff = Date.now() - new Date(activeProject.updatedAt).getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }, [isRunning, activeProject?.updatedAt]);

  const recentErrorCount = useMemo(() => {
    const oneHourAgo = Date.now() - 3600000;
    return errorEntries.filter((e) => new Date(e.time).getTime() > oneHourAgo).length;
  }, [errorEntries]);

  const displayErrors = useMemo(() => errorEntries.slice(-3), [errorEntries]);

  useEffect(() => {
    if (isBuilding) {
      setPipelineOpen(true);
    } else {
      setPipelineOpen(false);
    }
  }, [isBuilding]);

  useEffect(() => {
    let mounted = true;
    getProjectDeployments(projectId, 5)
      .then((deployments) => {
        if (mounted) {
          setRecentDeploys(deployments);
          if (deployments.length > 0) {
            setLatestDeploy(deployments[0]);
          }
        }
      })
      .catch((err) => console.error('Failed to fetch deployments:', err));

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    let mounted = true;

    Promise.all([getServices(), getProjectEnv(projectId)])
      .then(([allServices, envVars]) => {
        if (!mounted) return;
        setEnvVarCount(Object.keys(envVars).length);
        const allValues = Object.values(envVars).join(' ');
        const connected = allServices.filter((s) => allValues.includes(s.container_name));
        setConnectedServices(connected);
      })
      .catch((err) => console.error('Failed to fetch services/env:', err));

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!isRunning) {
      setErrorEntries([]);
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    async function fetchErrors() {
      try {
        const res = await fetch(`/api/projects/${projectId}/logs?lines=200`, {
          signal: controller.signal,
        });
        if (!res.ok || !mounted) return;
        const data = (await res.json()) as { logs?: unknown };
        const logs = typeof data.logs === 'string' ? data.logs : '';
        const entries = parseStaticLogEntries(logs);
        const errors = entries.filter((e) => {
          const level = e.stream === 'stderr' ? 'error' : detectLevel(e.line);
          return level === 'error';
        });
        if (mounted) setErrorEntries(errors);
      } catch (_) {
        void _;
      }
    }

    void fetchErrors();
    const interval = setInterval(fetchErrors, 30_000);

    return () => {
      mounted = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [projectId, isRunning]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 p-6 bg-bg-app max-w-5xl mx-auto w-full">
      {/* ── Section 1: Current State ─────────────────────────────────────── */}
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
            <div className="min-w-0">
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
              {latestDeploy.commitMessage && (
                <p className="text-xs text-secondary-ol truncate mt-1">
                  {latestDeploy.commitMessage}
                </p>
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
                ? '\u2713 Succeeded'
                : latestDeploy.status === 'failed'
                  ? 'Failed'
                  : 'Cancelled'}
            </span>
          </div>
        )}

        {/* Last event */}
        {lastEvent && (
          <p className="text-xs text-muted-ol">
            Last event: {lastEvent.title} — {formatRelativeTime(lastEvent.timestamp)}
          </p>
        )}
      </section>

      {/* ── Deploy Pipeline (contextual: only during build) ────────────── */}
      {isBuilding && (
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
            <span className="text-xs text-warning animate-pulse">Building...</span>
          </button>
          {pipelineOpen && (
            <div className="rounded-lg border border-border bg-bg-terminal overflow-hidden mb-4 min-h-[350px]">
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
      )}

      {/* ── 2-col Grid: Connected Services | Project Info ────────────── */}
      <section className="border-t border-border py-5">
        <div className="grid grid-cols-2 gap-8">
          {/* Left: Connected Services */}
          <div>
            <h3 className="text-xs font-medium text-muted-ol uppercase tracking-wider mb-3">
              Connected Services
            </h3>
            {connectedServices.length > 0 ? (
              <div className="space-y-2.5">
                {connectedServices.map((service) => (
                  <div key={service.id} className="flex items-center gap-2.5 text-sm">
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full shrink-0',
                        service.status === 'running'
                          ? 'bg-success shadow-[0_0_4px_rgba(22,163,74,0.4)]'
                          : service.status === 'error'
                            ? 'bg-error'
                            : 'bg-[var(--text-muted)]',
                      )}
                    />
                    <span className="text-primary-ol font-medium truncate">{service.name}</span>
                    <span className="text-muted-ol font-mono text-xs">:{service.port}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-ol flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                No connected services
              </p>
            )}
          </div>

          {/* Right: Project Info */}
          <div>
            <h3 className="text-xs font-medium text-muted-ol uppercase tracking-wider mb-3">
              Project Info
            </h3>
            <div className="space-y-2.5 text-sm">
              {/* Env var count */}
              <div className="flex items-center justify-between">
                <span className="text-muted-ol">Environment Variables</span>
                <button
                  onClick={onOpenSettings}
                  className="flex items-center gap-1 text-secondary-ol hover:text-primary-ol transition-colors"
                >
                  <span className="font-medium">{envVarCount} configured</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>

              {/* Uptime */}
              {uptime && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-ol">Uptime</span>
                  <span className="text-secondary-ol font-medium">{uptime}</span>
                </div>
              )}

              {/* Container image */}
              {imageTag && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-ol">Container</span>
                  <span className="text-xs font-mono text-secondary-ol truncate max-w-[200px]">
                    {imageTag}
                  </span>
                </div>
              )}

              {/* Port */}
              {activeProject?.port !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-ol">Port</span>
                  <span className="text-secondary-ol font-mono">{activeProject.port}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Error Logs ───────────────────────────────────────────────────── */}
      <section className="border-t border-border py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <h3 className="text-xs font-medium text-muted-ol uppercase tracking-wider">
              Error Logs
            </h3>
            {recentErrorCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-error/10 text-error">
                <AlertCircle className="h-3 w-3" />
                {recentErrorCount} error{recentErrorCount !== 1 ? 's' : ''} (1h)
              </span>
            )}
          </div>
          <button
            onClick={onOpenLogs}
            className="text-xs text-muted-ol hover:text-primary-ol transition-colors flex items-center gap-1"
          >
            <SquareTerminal className="h-3 w-3" />
            View all logs <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {!isRunning ? (
          <p className="text-xs text-muted-ol py-4 text-center">Container is not running</p>
        ) : displayErrors.length > 0 ? (
          <div className="rounded-lg border border-error/20 bg-bg-terminal overflow-hidden">
            <div className="divide-y divide-border/30">
              {displayErrors.map((entry) => (
                <div
                  key={entry.id}
                  className="px-3 py-1.5 font-mono text-[11px] text-error truncate"
                >
                  {normalizeLogText(entry.line)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-success flex items-center gap-1.5 py-2">
            <CheckCircle2 className="h-3.5 w-3.5" />
            No recent errors
          </p>
        )}
      </section>

      {/* ── Recent Deployments ───────────────────────────────────────────── */}
      <section className="border-t border-border py-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-muted-ol uppercase tracking-wider">
            Recent Deployments
          </h3>
          <button
            onClick={onOpenDeployments}
            className="text-xs text-muted-ol hover:text-primary-ol transition-colors flex items-center gap-1"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {recentDeploys.length > 0 ? (
          <div className="divide-y divide-border/50">
            {recentDeploys.map((deploy) => {
              const statusMeta = getDeploymentStatusMeta(deploy.status);
              const shortSha = getShortCommitSha(deploy.commitSha);

              return (
                <div
                  key={deploy.id}
                  className={cn(
                    'flex items-center gap-3 py-2 transition-colors hover:bg-bg-subtle/50 rounded-sm',
                    deploy.trigger === 'chat' && 'ai-deploy-border',
                  )}
                >
                  <div className={cn('h-2 w-2 rounded-full shrink-0', statusMeta.dotClass)} />
                  <TriggerIcon trigger={deploy.trigger} />
                  <span className={cn('text-[11px] font-body shrink-0', statusMeta.textClass)}>
                    {statusMeta.label}
                  </span>
                  {shortSha && (
                    <span className="text-[11px] font-mono text-muted-ol shrink-0">{shortSha}</span>
                  )}
                  {deploy.commitMessage && (
                    <span className="text-[11px] font-body text-muted-ol truncate min-w-0">
                      {deploy.commitMessage}
                    </span>
                  )}

                  {deploy.failureSummary && (
                    <span className="text-[11px] font-body text-error truncate min-w-0">
                      {deploy.failureSummary}
                    </span>
                  )}

                  <div className="flex-1" />

                  <div className="flex items-center gap-3 text-[11px] font-body text-muted-ol shrink-0">
                    {deploy.durationMs && (
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {formatDeploymentDuration(deploy.durationMs)}
                      </span>
                    )}
                    <span className="flex items-center gap-1 w-16 justify-end">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(deploy.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-ol py-4 text-center">No deployments yet</p>
        )}
      </section>
    </div>
  );
}
