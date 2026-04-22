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
import { redeployProject } from '@/lib/api';
import { getStatusConfigMap } from '@/lib/status-config';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';

function getStatusConfig() {
  return getStatusConfigMap({
    running: 'Healthy',
    stopped: 'Stopped',
    building: 'Deploying',
    error: 'Failed',
  });
}

export function ProjectsGrid() {
  const navigate = useNavigate();
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
      <div className="flex flex-col h-full w-full">
        <PageHeader title={t('projects.title')} />
        <div className="p-6 xl:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-5">
            {[1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-[140px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const headerActions = (
    <>
      <label className="flex items-center gap-2 text-sm font-body text-foreground/80 cursor-pointer">
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
              ? 'bg-bg-panel shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground/80',
          )}
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          onClick={() => toggleView('table')}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            viewMode === 'table'
              ? 'bg-bg-panel shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground/80',
          )}
        >
          <List className="h-4 w-4" />
        </button>
      </div>
      <button
        onClick={() => navigate('/projects/new')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body bg-agent text-white hover:bg-agent/90 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('projects.newProject')}
      </button>
    </>
  );

  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader
        title={t('projects.title')}
        description={t('projects.monitored', { count: String(filteredProjects.length) })}
        actions={headerActions}
      />
      <div className="p-6 xl:p-8 space-y-8">
        <SystemHealthCards
          serverStatus={serverStatus}
          setupStatus={setupStatus}
          projects={filteredProjects}
          onNavigate={navigate}
          t={t}
        />

        {filteredProjects.length === 0 ? (
          <button
            onClick={() => navigate('/projects/new')}
            className="w-full max-w-md mx-auto flex flex-col items-center gap-4 py-16 px-8 rounded-lg border-2 border-dashed border-[hsl(var(--border))] hover:border-agent/40 bg-bg-panel hover:bg-bg-panel transition-all duration-200 group cursor-pointer"
          >
            <div className="p-4 rounded-full bg-agent/10 group-hover:bg-agent/15 transition-colors">
              <Plus className="h-8 w-8 text-agent" />
            </div>
            <div className="text-center">
              <p className="font-display font-semibold text-foreground">
                {t('projects.deployFirstApp')}
              </p>
              <p className="text-sm font-body text-foreground/80 mt-1">
                {t('projects.connectGithub')}
              </p>
            </div>
          </button>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 gap-5">
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
    </div>
  );
}
