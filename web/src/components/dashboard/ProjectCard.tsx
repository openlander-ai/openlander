import { Spinner } from '@/components/ui/spinner';
import type { ProjectWithOptionalEnvironments } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Clock, ExternalLink, GitBranch, RotateCw, Settings } from 'lucide-react';
import type { MouseEvent } from 'react';

interface StatusDisplay {
  label: string;
  dot: string;
  badge: string;
  border: string;
}

interface ProjectCardProps {
  project: ProjectWithOptionalEnvironments;
  statusConfig: Record<string, StatusDisplay>;
  redeployingId: string | null;
  onNavigate: (path: string) => void;
  onRedeploy: (event: MouseEvent, projectId: string) => Promise<void>;
  t: (key: string) => string;
}

export function ProjectCard({
  project,
  statusConfig,
  redeployingId,
  onNavigate,
  onRedeploy,
  t,
}: ProjectCardProps) {
  const status = statusConfig[project.status] ?? statusConfig.stopped;
  const environments = project.environments ?? [];
  const hasProd = environments.some((environment) => environment.type === 'production');
  const allEnvironments = hasProd
    ? environments
    : [{ type: 'production', status: project.status }, ...environments];

  return (
    <div
      key={project.id}
      onClick={() => onNavigate(`/projects/${project.id}`)}
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
              project.status === 'running' && 'shadow-[0_0_8px_rgba(52,211,153,0.6)]',
              project.status === 'error' && 'shadow-[0_0_8px_rgba(248,113,113,0.6)]',
              project.status === 'building' && 'shadow-[0_0_8px_rgba(251,191,36,0.6)]',
            )}
          />
          <h3 className="font-display font-semibold text-base text-primary-ol truncate">
            {project.name}
          </h3>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', status.badge)}>
          {status.label}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Last Deploy
            </p>
            <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol">
              <Clock className="h-3.5 w-3.5" />
              {formatRelativeTime(project.updatedAt, t)}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Branch
            </p>
            <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol truncate">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{project.branch || 'main'}</span>
            </div>
          </div>
        </div>

        {project.url && (
          <div>
            <p className="text-[10px] font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Endpoint
            </p>
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1.5 text-xs font-mono text-agent hover:text-agent/80 truncate transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              {project.url.replace(/^https?:\/\//, '')}
            </a>
          </div>
        )}

        {allEnvironments.length > 0 && (
          <div className="pt-2 border-t border-[hsl(var(--border))]/50">
            <p className="text-[10px] font-mono text-muted-ol mb-2 uppercase tracking-[0.08em]">
              Environments
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {allEnvironments.map((environment) => {
                const environmentStatus = statusConfig[environment.status] ?? statusConfig.stopped;
                return (
                  <button
                    key={environment.type}
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigate(`/projects/${project.id}?env=${environment.type}`);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[hsl(var(--border))] hover:border-agent/30 bg-bg-subtle hover:bg-bg-panel transition-colors group/env"
                    title={`${environment.type} - ${environmentStatus.label}`}
                  >
                    <div className={cn('h-1.5 w-1.5 rounded-full', environmentStatus.dot)} />
                    <span className="text-[10px] font-mono text-secondary-ol group-hover/env:text-primary-ol transition-colors">
                      {environment.type === 'production'
                        ? 'prod'
                        : environment.type === 'development'
                          ? 'dev'
                          : String(environment.type).substring(0, 4)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-bg-panel/90 backdrop-blur-sm rounded-md p-1 border border-[hsl(var(--border))] shadow-sm">
        <button
          onClick={(event) => {
            void onRedeploy(event, project.id);
          }}
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
          onClick={(event) => {
            event.stopPropagation();
            onNavigate(`/projects/${project.id}`);
          }}
          className="p-1.5 rounded text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle transition-colors"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
