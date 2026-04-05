import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProjectWithOptionalEnvironments } from '@/lib/api/projects';
import { listProjects } from '@/lib/api/projects';
import { useLanguage } from '@/i18n/context';
import { ApprovalQueue } from '@/components/ops/ApprovalQueue';
import { IncidentMap } from '@/components/ops/IncidentMap';
import { ActivityFeed } from '@/components/ops/ActivityFeed';
import { CircuitBreakerMap } from '@/components/ops/CircuitBreakerMap';
import { AgentActivityPanel } from '@/components/ops/AgentActivityPanel';

export function OpsCenter() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectWithOptionalEnvironments[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const selectedProjectId = searchParams.get('project') ?? '';

  useEffect(() => {
    let cancelled = false;

    const loadProjects = async () => {
      try {
        const data = await listProjects(false);
        if (!cancelled) {
          setProjects(data);
        }
      } catch (err) {
        console.error('Failed to load projects for Ops Center', err);
      } finally {
        if (!cancelled) {
          setLoadingProjects(false);
        }
      }
    };

    void loadProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRefreshToken((prev) => prev + 1);
    }, 10_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId || loadingProjects) {
      return;
    }
    const isValid = projects.some((project) => project.id === selectedProjectId);
    if (!isValid) {
      const next = new URLSearchParams(searchParams);
      next.delete('project');
      setSearchParams(next, { replace: true });
    }
  }, [loadingProjects, projects, searchParams, selectedProjectId, setSearchParams]);

  const filteredProjectId = useMemo(() => {
    if (!selectedProjectId) {
      return undefined;
    }
    return projects.some((project) => project.id === selectedProjectId)
      ? selectedProjectId
      : undefined;
  }, [projects, selectedProjectId]);

  const projectNameById = useMemo(() => {
    return Object.fromEntries(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const handleProjectFilterChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === 'all') {
      next.delete('project');
    } else {
      next.set('project', value);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex-1 overflow-auto bg-app p-4 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-primary-ol">
              {t('operations.title')}
            </h1>
            <p className="mt-1 text-sm text-muted-ol font-body">{t('operations.description')}</p>
          </div>
          <div className="w-full md:w-64">
            {loadingProjects ? (
              <Skeleton className="h-10 w-full rounded-md" />
            ) : (
              <Select value={filteredProjectId ?? 'all'} onValueChange={handleProjectFilterChange}>
                <SelectTrigger className="bg-panel border-border font-body text-sm text-primary-ol">
                  <SelectValue placeholder={t('operations.activity.allProjects')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('operations.activity.allProjects')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <AgentActivityPanel />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Action Items (2/3 width) */}
          <div className="space-y-5 lg:col-span-2">
            <ApprovalQueue projectId={filteredProjectId} projectNameById={projectNameById} />
            <IncidentMap
              projectId={filteredProjectId}
              projectNameById={projectNameById}
              refreshToken={refreshToken}
            />
          </div>

          {/* System Tracking (1/3 width) */}
          <div className="space-y-5">
            <CircuitBreakerMap
              projectId={filteredProjectId}
              projectNameById={projectNameById}
              refreshToken={refreshToken}
            />
            <ActivityFeed projectId={filteredProjectId} />
          </div>
        </div>
      </div>
    </div>
  );
}
