import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { ProjectCard } from '@/components/dashboard/ProjectCard';
import { ProjectTable } from '@/components/dashboard/ProjectTable';
import { SystemHealthCards } from '@/components/dashboard/SystemHealthCards';
import { Skeleton } from '@/components/ui/skeleton';
import { useProjects } from '@/hooks/use-projects';
import { useSystemStatus } from '@/hooks/use-system-status';
import { useLanguage } from '@/i18n/context';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { redeployProject } from '@/lib/api';
import { cn } from '@/lib/utils';

function getStatusConfig(): Record<
  string,
  { label: string; dot: string; badge: string; border: string }
> {
  return {
    running: {
      label: 'Healthy',
      dot: 'bg-success animate-pulse',
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
      dot: 'bg-warning animate-pulse-ring',
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
  const [showArchived, setShowArchived] = useState(false);
  const { projects, loading: projectsLoading, refetch } = useProjects(showArchived);
  const { serverStatus, setupStatus, loading: systemLoading } = useSystemStatus();
  const { t } = useLanguage();
  const statusConfig = getStatusConfig();
  const [redeployingIds, setRedeployingIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    return (localStorage.getItem('openlander-view-mode') as 'grid' | 'table') || 'grid';
  });

  const filteredProjects = projects;

  const toggleView = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    localStorage.setItem('openlander-view-mode', mode);
  };

  const handleRedeploy = async (event: MouseEvent, projectId: string) => {
    event.stopPropagation();
    if (isMobile) {
      showMobileToast();
      return;
    }
    setRedeployingIds((prev) => new Set(prev).add(projectId));
    try {
      await redeployProject(projectId);
      refetch();
    } catch (error) {
      console.error('Redeploy failed:', error);
    } finally {
      setRedeployingIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  if (projectsLoading || systemLoading) {
    return (
      <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-7 w-32 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-[140px] w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-8">
      <SystemHealthCards
        serverStatus={serverStatus}
        setupStatus={setupStatus}
        projects={filteredProjects}
        onNavigate={navigate}
        t={t}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl text-primary-ol tracking-tight">
            Project Overview
          </h1>
          <p className="text-sm font-body text-secondary-ol mt-0.5">
            {filteredProjects.length}{' '}
            {filteredProjects.length === 1 ? 'project monitored' : 'projects monitored'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-body text-secondary-ol cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-border bg-bg-subtle text-agent focus:ring-agent"
            />
            {t('projects.filter.showArchived')}
          </label>
          <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-0.5">
            <button
              onClick={() => toggleView('grid')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'grid'
                  ? 'bg-bg-panel shadow-sm text-primary-ol'
                  : 'text-muted-ol hover:text-secondary-ol',
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => toggleView('table')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'table'
                  ? 'bg-bg-panel shadow-sm text-primary-ol'
                  : 'text-muted-ol hover:text-secondary-ol',
              )}
            >
              <List className="h-4 w-4" />
            </button>
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
            New Project
          </button>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <button
          onClick={() => navigate('/projects/new')}
          className="w-full max-w-md mx-auto flex flex-col items-center gap-4 py-16 px-8 rounded-lg border-2 border-dashed border-[hsl(var(--border))] hover:border-agent/40 bg-bg-panel hover:bg-bg-panel transition-all duration-200 group cursor-pointer"
        >
          <div className="p-4 rounded-full bg-agent/10 group-hover:bg-agent/15 transition-colors">
            <Plus className="h-8 w-8 text-agent" />
          </div>
          <div className="text-center">
            <p className="font-display font-semibold text-primary-ol">
              {t('projects.deployFirstApp')}
            </p>
            <p className="text-sm font-body text-secondary-ol mt-1">
              {t('projects.connectGithub')}
            </p>
          </div>
        </button>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              statusConfig={statusConfig}
              redeployingIds={redeployingIds}
              onNavigate={navigate}
              onRedeploy={handleRedeploy}
              t={t}
            />
          ))}
        </div>
      ) : (
        <ProjectTable
          projects={filteredProjects}
          statusConfig={statusConfig}
          onNavigate={navigate}
          t={t}
        />
      )}
    </div>
  );
}
