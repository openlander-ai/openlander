import { useEnvironment } from '@/contexts/environment';
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
  const { environment: selectedEnv } = useEnvironment();

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
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const environments = project.environments ?? [];
            const currentEnvData = environments.find((e) => e.type === selectedEnv);
            const currentStatus = currentEnvData
              ? currentEnvData.status
              : selectedEnv === 'production'
                ? project.status
                : 'idle';
            const status = statusConfig[currentStatus] ?? statusConfig.stopped;

            const hasProd = environments.some((environment) => environment.type === 'production');
            const allEnvironments = hasProd
              ? environments
              : [{ type: 'production', status: project.status }, ...environments];

            return (
              <tr
                key={project.id}
                onClick={() => onNavigate(`/projects/${project.id}`)}
                className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-bg-subtle/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 font-medium text-primary-ol">
                  <div className="flex items-center gap-2">
                    {project.name}
                    <div className="flex items-center gap-1.5">
                      {allEnvironments.map((env) => {
                        if (
                          env.type === 'development' &&
                          !environments.some((e) => e.type === 'development')
                        )
                          return null;
                        const envStatus = statusConfig[env.status] ?? statusConfig.stopped;
                        return (
                          <div
                            key={env.type}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-subtle border border-[hsl(var(--border))] text-[10px] font-mono text-secondary-ol"
                            title={`${env.type} - ${envStatus.label}`}
                          >
                            <div className={cn('h-1.5 w-1.5 rounded-full', envStatus.dot)} />
                            {env.type === 'production' ? 'PROD' : 'DEV'}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </td>
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
                            className="text-xs text-purple-400 hover:underline truncate max-w-[200px] flex items-center gap-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className="text-[9px] px-1 rounded bg-purple-500/10 border border-purple-500/20">
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
