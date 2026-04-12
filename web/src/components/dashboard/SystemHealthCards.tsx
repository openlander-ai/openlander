import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { ProjectWithOptionalEnvironments, ServerStatus, SetupStatus } from '@/lib/api';
import { AlertCircle, AlertTriangle, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';

interface SystemHealthCardsProps {
  serverStatus: ServerStatus | null;
  setupStatus: SetupStatus | null;
  projects: ProjectWithOptionalEnvironments[];
  onNavigate: (path: string) => void;
  t: (key: string) => string;
}

interface Issue {
  id: string;
  icon: 'error' | 'warning';
  label: string;
  action?: string;
  onClick?: () => void;
}

export function SystemHealthCards({
  setupStatus,
  projects,
  onNavigate,
  t,
}: SystemHealthCardsProps) {
  const [dismissed, setDismissed] = useState(false);

  const isDockerOk = setupStatus?.docker?.ok;
  const isTraefikOk = setupStatus?.traefik?.ok;
  const isLlmOk = setupStatus?.llm?.ok;
  const errorProjects = projects.filter((project) => project.status === 'error');

  // Collect all issues
  const issues: Issue[] = [];

  if (!isDockerOk) {
    issues.push({
      id: 'docker',
      icon: 'error',
      label: 'Docker Engine is disconnected',
      action: 'Settings',
      onClick: () => onNavigate('/settings'),
    });
  }

  if (!isTraefikOk) {
    issues.push({
      id: 'traefik',
      icon: 'warning',
      label: 'Traefik Proxy is offline — redeployments may break external access',
      action: 'Settings',
      onClick: () => onNavigate('/settings'),
    });
  }

  if (!isLlmOk) {
    issues.push({
      id: 'llm',
      icon: 'warning',
      label: 'AI Recovery is not configured — auto-fix disabled',
      action: 'Configure',
      onClick: () => onNavigate('/settings'),
    });
  }

  for (const project of errorProjects) {
    issues.push({
      id: `project-${project.id}`,
      icon: 'error',
      label: `${project.name} — deployment failed ${formatRelativeTime(project.updatedAt, t)}`,
      action: 'View',
      onClick: () => onNavigate(`/projects/${project.id}`),
    });
  }

  // All OK = render nothing
  if (issues.length === 0 || dismissed) {
    return null;
  }

  const hasErrors = issues.some((i) => i.icon === 'error');

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 space-y-1.5',
        hasErrors ? 'bg-error/5 border-error/20' : 'bg-warning/5 border-warning/20',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasErrors ? (
            <AlertCircle className="h-4 w-4 text-error shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
          )}
          <span className={cn('text-sm font-semibold', hasErrors ? 'text-error' : 'text-warning')}>
            {issues.length === 1
              ? '1 issue needs attention'
              : `${issues.length} issues need attention`}
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 rounded-md text-muted-ol hover:text-primary-ol hover:bg-bg-subtle transition-colors"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        {issues.map((issue) => (
          <button
            key={issue.id}
            onClick={issue.onClick}
            className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-md hover:bg-bg-panel/60 transition-colors group"
          >
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                issue.icon === 'error' ? 'bg-error' : 'bg-warning',
              )}
            />
            <span className="text-xs font-body text-secondary-ol flex-1 truncate">
              {issue.label}
            </span>
            {issue.action && (
              <span className="text-[10px] font-medium text-muted-ol group-hover:text-agent flex items-center gap-0.5 shrink-0 transition-colors">
                {issue.action}
                <ChevronRight className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
