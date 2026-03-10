import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import { useProjects } from '@/hooks/use-projects';
import { redeployProject } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Plus, ExternalLink, GitBranch, Clock, RotateCw, Settings, Loader2 } from 'lucide-react';

function getStatusConfig(): Record<string, { label: string; dot: string; badge: string }> {
  return {
    running: {
      label: 'Live',
      dot: 'bg-success',
      badge: 'text-success border-success/30 bg-success/10',
    },
    stopped: {
      label: 'Stopped',
      dot: 'bg-[var(--text-muted)]',
      badge: 'text-muted-ol border-[var(--text-muted)]/30 bg-[var(--text-muted)]/10',
    },
    building: {
      label: 'Deploying',
      dot: 'bg-warning animate-pulse',
      badge: 'text-warning border-warning/30 bg-warning/10',
    },
    error: {
      label: 'Failed',
      dot: 'bg-error',
      badge: 'text-error border-error/30 bg-error/10',
    },
  };
}

export function ProjectsGrid() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { projects, loading, refetch } = useProjects();
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

  if (loading) {
    return (
      <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-32 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 h-[104px] flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-5 w-32" />
                </div>
                <Skeleton className="h-5 w-16 rounded" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-48" />
                <div className="flex gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-xl text-primary-ol tracking-tight">
            {'Projects'}
          </h1>
          <p className="text-xs font-body text-secondary-ol mt-0.5">
            {projects.length} {projects.length === 1 ? 'project deployed' : 'projects deployed'}
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

      {/* Grid */}
      {projects.length === 0 ? (
        /* Empty State */
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
                className="group relative flex flex-col rounded-lg border border-[hsl(var(--border))] bg-bg-panel hover:border-agent/30 hover:bg-bg-panel/80 transition-all duration-200 cursor-pointer overflow-hidden card-hover"
              >
                {/* Card Header */}
                <div className="flex items-center justify-between p-4 pb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.dot)} />
                    <h3 className="font-display font-semibold text-sm text-primary-ol truncate">
                      {project.name}
                    </h3>
                  </div>
                  <span
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0',
                      status.badge,
                    )}
                  >
                    {status.label}
                  </span>
                </div>

                {/* Card Body */}
                <div className="px-4 pb-3 space-y-1.5">
                  {project.url && (
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 text-[11px] font-mono text-agent hover:text-agent/80 truncate transition-colors"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {project.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                  <div className="flex items-center gap-3 text-[10px] font-body text-muted-ol">
                    {project.branch && (
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {project.branch}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(project.updatedAt, t)}
                    </span>
                  </div>
                </div>

                {/* Hover Actions */}
                <div className="absolute bottom-0 left-0 right-0 flex items-center justify-end gap-1 p-2 bg-gradient-to-t from-bg-panel via-bg-panel/95 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <button
                    onClick={(e) => handleRedeploy(e, project.id)}
                    disabled={redeployingId === project.id}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-body text-secondary-ol hover:text-agent hover:bg-agent/10 transition-colors disabled:opacity-50"
                  >
                    {redeployingId === project.id ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <RotateCw className="h-3 w-3" />
                    )}
                    {'Redeploy'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/projects/${project.id}`);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-body text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle transition-colors"
                  >
                    <Settings className="h-3 w-3" />
                    {'Settings'}
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
