import { Spinner } from '@/components/ui/spinner';
import type { Project } from '@/types';
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
  project: Project;
  statusConfig: Record<string, StatusDisplay>;
  redeployingIds: Set<string>;
  onNavigate: (path: string) => void;
  onRedeploy: (event: MouseEvent, projectId: string) => Promise<void>;
  t: (key: string) => string;
}

export function ProjectCard({
  project,
  statusConfig,
  redeployingIds,
  onNavigate,
  onRedeploy,
  t,
}: ProjectCardProps) {
  const status = statusConfig[project.status] ?? statusConfig.stopped;

  return (
    <div
      key={project.id}
      onClick={() => onNavigate(`/projects/${project.id}`)}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-bg-panel hover:bg-bg-subtle transition-all duration-200 cursor-pointer overflow-hidden card-hover min-h-[160px]',
        status.border,
        project.archived_at && 'opacity-60 grayscale-[0.5]',
      )}
    >
      <div className="flex items-center justify-between p-5 pb-3 border-b border-[hsl(var(--border))]/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('h-2 w-2 rounded-full shrink-0', status.dot)} />
          <h3 className="font-display font-semibold text-base text-foreground truncate">
            {project.name}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.archived_at && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-bg-subtle text-muted-foreground border border-border">
              {t('projects.card.archivedBadge')}
            </span>
          )}
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', status.badge)}>
            {statusConfig[project.status]?.label ?? 'Unknown'}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-2.5">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(project.updatedAt, t)}
          </span>
          {project.branch && (
            <span className="flex items-center gap-1 font-mono truncate max-w-[140px]">
              <GitBranch className="h-3 w-3 shrink-0" />
              {project.branch}
            </span>
          )}
        </div>
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-foreground truncate transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            {project.url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <div className="absolute top-5 right-5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-bg-panel/90 backdrop-blur-sm rounded-md p-1 border border-[hsl(var(--border))] shadow-sm">
        <button
          onClick={(event) => {
            void onRedeploy(event, project.id);
          }}
          disabled={redeployingIds.has(project.id)}
          className="p-1.5 rounded text-foreground/80 hover:text-agent hover:bg-agent/10 transition-colors disabled:opacity-50"
          title="Redeploy"
        >
          {redeployingIds.has(project.id) ? (
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
          className="p-1.5 rounded text-foreground/80 hover:text-foreground hover:bg-bg-subtle transition-colors"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
