import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import { useProjects } from '@/hooks/use-projects';
import { useSystemStatus } from '@/hooks/use-system-status';
import { redeployProject } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Plus,
  ExternalLink,
  GitBranch,
  Clock,
  RotateCw,
  Settings,
  Activity,
  Server,
  Box,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

function getStatusConfig(): Record<
  string,
  { label: string; dot: string; badge: string; border: string }
> {
  return {
    running: {
      label: 'Healthy',
      dot: 'bg-success',
      badge: 'bg-success/10 text-success border border-success/30',
      border: 'border-success/20',
    },
    stopped: {
      label: 'Stopped',
      dot: 'bg-[var(--text-muted)]',
      badge: 'bg-bg-subtle text-muted-ol border border-border',
      border: 'border-[hsl(var(--border))]',
    },
    building: {
      label: 'Deploying',
      dot: 'bg-warning animate-pulse',
      badge: 'bg-warning/10 text-warning border border-warning/30',
      border: 'border-warning/30',
    },
    error: {
      label: 'Failed',
      dot: 'bg-error',
      badge: 'bg-error/10 text-error border border-error/30',
      border: 'border-error/30',
    },
  };
}

export function ProjectsGrid() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { projects, loading: projectsLoading, refetch } = useProjects();
  const { serverStatus, setupStatus, loading: systemLoading } = useSystemStatus();
  const { t } = useLanguage();
  const statusConfig = getStatusConfig();
  const [redeployingId, setRedeployingId] = useState<string | null>(null);

  const handleRedeploy = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (isMobile) {
      showMobileToast();
      return;
    }
    setRedeployingId(projectId);
    try {
      await redeployProject(projectId);
      refetch();
    } catch (err) {
      console.error('Redeploy failed:', err);
    } finally {
      setRedeployingId(null);
    }
  };

  if (projectsLoading || systemLoading) {
    return (
      <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-6">
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-32 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[140px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const isDockerOk = setupStatus?.docker?.ok;
  const isTraefikOk = setupStatus?.traefik?.ok;
  const isLlmOk = setupStatus?.llm?.ok;
  const containerCount = serverStatus?.containers?.total ?? 0;

  return (
    <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 bg-bg-subtle rounded-md">
            <Activity className="h-5 w-5 text-primary-ol" />
          </div>
          <div>
            <p className="text-xs font-mono text-muted-ol mb-0.5">SYSTEM HEALTH</p>
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  isDockerOk && isTraefikOk ? 'bg-success' : 'bg-error',
                )}
              />
              <span className="text-sm font-semibold text-primary-ol">
                {isDockerOk && isTraefikOk ? 'All Systems Operational' : 'System Issues Detected'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 bg-bg-subtle rounded-md">
            <Box className="h-5 w-5 text-primary-ol" />
          </div>
          <div>
            <p className="text-xs font-mono text-muted-ol mb-0.5">DOCKER ENGINE</p>
            <div className="flex items-center gap-1.5">
              {isDockerOk ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-error" />
              )}
              <span className="text-sm font-semibold text-primary-ol">
                {isDockerOk ? `${containerCount} Containers` : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 bg-bg-subtle rounded-md">
            <Server className="h-5 w-5 text-primary-ol" />
          </div>
          <div>
            <p className="text-xs font-mono text-muted-ol mb-0.5">TRAEFIK PROXY</p>
            <div className="flex items-center gap-1.5">
              {isTraefikOk ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-error" />
              )}
              <span className="text-sm font-semibold text-primary-ol">
                {isTraefikOk ? 'Routing Active' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
          <div className="p-2.5 bg-bg-subtle rounded-md">
            <ShieldCheck className="h-5 w-5 text-primary-ol" />
          </div>
          <div>
            <p className="text-xs font-mono text-muted-ol mb-0.5">AI RECOVERY</p>
            <div className="flex items-center gap-1.5">
              {isLlmOk ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-agent" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-sm font-semibold text-primary-ol">
                {isLlmOk ? 'Armed & Ready' : 'Not Configured'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl text-primary-ol tracking-tight">
            {'Project Overview'}
          </h1>
          <p className="text-xs font-body text-secondary-ol mt-0.5">
            {projects.length} {projects.length === 1 ? 'project monitored' : 'projects monitored'}
          </p>
        </div>
        <button
          onClick={() => {
            if (isMobile) {
              showMobileToast();
              return;
            }
            navigate('/projects/new');
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body bg-foreground text-background hover:bg-foreground/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          {'New Project'}
        </button>
      </div>

      {projects.length === 0 ? (
        <button
          onClick={() => navigate('/projects/new')}
          className="w-full max-w-md mx-auto flex flex-col items-center gap-4 py-16 px-8 rounded-lg border-2 border-dashed border-[hsl(var(--border))] hover:border-agent/40 bg-bg-panel/50 hover:bg-bg-panel transition-all duration-200 group cursor-pointer"
        >
          <div className="p-4 rounded-full bg-agent/10 group-hover:bg-agent/15 transition-colors">
            <Plus className="h-8 w-8 text-agent" />
          </div>
          <div className="text-center">
            <p className="font-display font-semibold text-primary-ol">
              {t('projects.deployFirstApp')}
            </p>
            <p className="text-xs font-body text-secondary-ol mt-1">
              {t('projects.connectGithub')}
            </p>
          </div>
        </button>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {projects.map((project) => {
            const status = statusConfig[project.status] ?? statusConfig.stopped;

            return (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className={cn(
                  'group relative flex flex-col rounded-lg border bg-bg-panel hover:bg-bg-panel/80 hover:shadow-md hover:border-agent/20 transition-all duration-200 cursor-pointer overflow-hidden card-hover',
                  status.border,
                )}
              >
                <div className="flex items-center justify-between p-4 pb-3 border-b border-[hsl(var(--border))]/50">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        'h-2.5 w-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.2)]',
                        status.dot,
                        project.status === 'running' && 'shadow-success/40',
                      )}
                    />
                    <h3 className="font-display font-semibold text-base text-primary-ol truncate">
                      {project.name}
                    </h3>
                  </div>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
                      status.badge,
                    )}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-mono text-muted-ol mb-1">Last Deploy</p>
                      <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol">
                        <Clock className="h-3.5 w-3.5" />
                        {formatRelativeTime(project.updatedAt, t)}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-mono text-muted-ol mb-1">Branch</p>
                      <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol truncate">
                        <GitBranch className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{project.branch || 'main'}</span>
                      </div>
                    </div>
                  </div>

                  {project.url && (
                    <div>
                      <p className="text-[10px] font-mono text-muted-ol mb-1">Endpoint</p>
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 text-xs font-mono text-agent hover:text-agent/80 truncate transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        {project.url.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  )}

                  {(() => {
                    if (!project.environments || project.environments.length === 0) return null;

                    const hasProd = project.environments.some((e) => e.type === 'production');
                    const allEnvs = hasProd
                      ? project.environments
                      : [{ type: 'production', status: project.status }, ...project.environments];

                    return (
                      <div className="pt-2 border-t border-[hsl(var(--border))]/50">
                        <p className="text-[10px] font-mono text-muted-ol mb-2">Environments</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {allEnvs.map((env) => {
                            const envStatus = statusConfig[env.status] ?? statusConfig.stopped;
                            return (
                              <button
                                key={env.type}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/projects/${project.id}?env=${env.type}`);
                                }}
                                className="flex items-center gap-1.5 px-2 py-1 rounded border border-[hsl(var(--border))] hover:border-agent/30 bg-bg-subtle hover:bg-bg-panel transition-colors group/env"
                                title={`${env.type} - ${envStatus.label}`}
                              >
                                <div className={cn('h-1.5 w-1.5 rounded-full', envStatus.dot)} />
                                <span className="text-[10px] font-mono text-secondary-ol group-hover/env:text-primary-ol transition-colors">
                                  {env.type === 'production'
                                    ? 'prod'
                                    : env.type === 'development'
                                      ? 'dev'
                                      : env.type.substring(0, 4)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-bg-panel/90 backdrop-blur-sm rounded-md p-1 border border-[hsl(var(--border))] shadow-sm">
                  <button
                    onClick={(e) => handleRedeploy(e, project.id)}
                    disabled={redeployingId === project.id}
                    className="p-1.5 rounded text-secondary-ol hover:text-agent hover:bg-agent/10 transition-colors disabled:opacity-50"
                    title="Redeploy"
                  >
                    {redeployingId === project.id ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <RotateCw className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/projects/${project.id}`);
                    }}
                    className="p-1.5 rounded text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle transition-colors"
                    title="Settings"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
