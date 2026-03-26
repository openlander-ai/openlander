import { useEnvironment } from '@/contexts/environment';
import { Spinner } from '@/components/ui/spinner';
import type { ProjectWithOptionalEnvironments } from '@/lib/api';
import { getSetupStatus } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Clock, ExternalLink, GitBranch, RotateCw, Settings, Sparkles } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';

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
  const { environment: selectedEnv } = useEnvironment();
  const environments = project.environments ?? [];
  const [llmConfigured, setLlmConfigured] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then((s) => setLlmConfigured(s.llm.ok))
      .catch(() => setLlmConfigured(false));
  }, []);

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
              'h-2.5 w-2.5 rounded-full shrink-0 shadow-[0_0_6px_rgba(0,0,0,0.1)]',
              status.dot,
              currentStatus === 'running' && 'shadow-[0_0_6px_rgba(22,163,74,0.4)]',
              currentStatus === 'error' && 'shadow-[0_0_6px_rgba(220,38,38,0.4)]',
              currentStatus === 'building' && 'shadow-[0_0_6px_rgba(217,119,6,0.4)]',
            )}
          />
          <h3 className="font-display font-semibold text-base text-primary-ol truncate">
            {project.name}
          </h3>
          <div className="flex items-center gap-1.5 ml-1">
            {allEnvironments.map((env) => {
              if (env.type === 'development' && !environments.some((e) => e.type === 'development'))
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
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', status.badge)}>
          {status.label}
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Last Deploy
            </p>
            <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol">
              <Clock className="h-3.5 w-3.5" />
              {formatRelativeTime(project.updatedAt, t)}
            </div>
          </div>
          <div>
            <p className="text-xs font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Branch
            </p>
            <div className="flex items-center gap-1.5 text-xs font-body text-secondary-ol truncate">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{project.branch || 'main'}</span>
            </div>
          </div>
        </div>

        {(currentEnvData?.publicUrl ?? project.url) && (
          <div>
            <p className="text-xs font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Endpoint
            </p>
            <a
              href={currentEnvData?.publicUrl ?? project.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1.5 text-xs font-mono text-agent hover:text-agent/80 truncate transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              {(currentEnvData?.publicUrl ?? project.url ?? '').replace(/^https?:\/\//, '')}
            </a>
            {project.urls
              ?.filter((u) => u.type === 'vpn')
              .map((vpn) => (
                <a
                  key={vpn.ip}
                  href={vpn.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="flex items-center gap-1.5 text-xs font-mono text-purple-400 hover:text-purple-300 truncate transition-colors mt-1"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  {vpn.url.replace(/^https?:\/\//, '')}
                </a>
              ))}
          </div>
        )}

        {project.publicUrl && (
          <div>
            <p className="text-xs font-mono text-muted-ol mb-1 uppercase tracking-[0.08em]">
              Public
            </p>
            <a
              href={project.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1.5 text-xs font-mono text-success hover:text-success/80 truncate transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              {project.publicUrl.replace(/^https?:\/\//, '')}
            </a>
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
            <div className="flex items-center gap-1">
              {llmConfigured && <Sparkles className="h-3 w-3 text-agent" />}
              <RotateCw className="h-4 w-4" />
            </div>
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
