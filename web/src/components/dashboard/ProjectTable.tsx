import type { ProjectWithOptionalEnvironments } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface StatusDisplay {
  label: string;
  dot: string;
  badge: string;
  border: string;
}

interface ProjectTableProps {
  projects: ProjectWithOptionalEnvironments[];
  statusConfig: Record<string, StatusDisplay>;
  onNavigate: (path: string) => void;
  t: (key: string) => string;
}

export function ProjectTable({ projects, statusConfig, onNavigate, t }: ProjectTableProps) {
  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden bg-bg-panel">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] bg-bg-subtle/50">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol">Name</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol">Status</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol hidden md:table-cell">
              Branch
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol hidden md:table-cell">
              Last Deploy
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol hidden lg:table-cell">
              Endpoint
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-ol hidden lg:table-cell">
              Envs
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const status = statusConfig[project.status] ?? statusConfig.stopped;
            return (
              <tr
                key={project.id}
                onClick={() => onNavigate(`/projects/${project.id}`)}
                className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-bg-subtle/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-medium text-primary-ol">{project.name}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', status.dot)} />
                    <span className="text-xs font-medium text-secondary-ol">{status.label}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary-ol hidden md:table-cell">
                  <span className="text-xs font-mono">{project.branch || 'main'}</span>
                </td>
                <td className="px-4 py-3 text-secondary-ol hidden md:table-cell">
                  <span className="text-xs">{formatRelativeTime(project.updatedAt, t)}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {project.url && (
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-agent hover:underline truncate max-w-[200px] block"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {project.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex gap-1 flex-wrap">
                    {project.environments?.map((environment) => (
                      <span
                        key={environment.id || environment.type}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-bg-subtle text-muted-ol border border-[hsl(var(--border))]"
                      >
                        {environment.type === 'production'
                          ? 'prod'
                          : environment.type === 'development'
                            ? 'dev'
                            : String(environment.type).substring(0, 4)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
