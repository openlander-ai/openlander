import type { Project } from '@/types';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface StatusDisplay {
  label: string;
  dot: string;
  badge: string;
  border: string;
}

interface ProjectTableProps {
  projects: Project[];
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
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
              Name
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
              Status
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">
              Branch
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">
              Last Deploy
            </th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden lg:table-cell">
              Endpoint
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
                <td className="px-4 py-3 font-medium text-foreground">{project.name}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 rounded-full', status.dot)} />
                    <span className="text-xs font-medium text-foreground/80">{status.label}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-foreground/80 hidden md:table-cell">
                  <span className="text-xs font-mono">{project.branch || 'main'}</span>
                </td>
                <td className="px-4 py-3 text-foreground/80 hidden md:table-cell">
                  <span className="text-xs">{formatRelativeTime(project.updatedAt, t)}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  {project.url && (
                    <div className="space-y-0.5">
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-agent hover:underline truncate max-w-[200px] block"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {project.url.replace(/^https?:\/\//, '')}
                      </a>
                      {project.urls
                        ?.filter((u) => u.type === 'vpn')
                        .map((vpn) => (
                          <a
                            key={vpn.ip}
                            href={vpn.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground hover:underline truncate max-w-[200px] flex items-center gap-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground border border-border">
                              VPN
                            </span>
                            {vpn.url.replace(/^https?:\/\//, '')}
                          </a>
                        ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
