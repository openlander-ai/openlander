import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { ProjectWithOptionalEnvironments, ServerStatus, SetupStatus } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Box,
  CheckCircle2,
  Server,
  ShieldCheck,
} from 'lucide-react';

interface SystemHealthCardsProps {
  serverStatus: ServerStatus | null;
  setupStatus: SetupStatus | null;
  projects: ProjectWithOptionalEnvironments[];
  onNavigate: (path: string) => void;
  t: (key: string) => string;
}

export function SystemHealthCards({
  serverStatus,
  setupStatus,
  projects,
  onNavigate,
  t,
}: SystemHealthCardsProps) {
  const isDockerOk = setupStatus?.docker?.ok;
  const isTraefikOk = setupStatus?.traefik?.ok;
  const isLlmOk = setupStatus?.llm?.ok;
  const containerCount = serverStatus?.containers?.total ?? 0;
  const errorProjects = projects.filter((project) => project.status === 'error');
  const isAllOk = isDockerOk && isTraefikOk && errorProjects.length === 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4 hover:bg-bg-subtle/50 transition-colors text-left w-full cursor-pointer">
            <div className="p-2.5 bg-bg-subtle rounded-md shrink-0">
              <Activity className="h-5 w-5 text-primary-ol" />
            </div>
            <div>
              <p className="text-xs font-mono text-muted-ol mb-0.5">SYSTEM HEALTH</p>
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    isAllOk ? 'bg-success' : 'bg-error',
                  )}
                />
                <span className="text-sm font-semibold text-primary-ol">
                  {isAllOk ? 'All Systems Operational' : 'System Issues Detected'}
                </span>
              </div>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start">
          <DropdownMenuLabel>System Issues</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!isTraefikOk && (
            <DropdownMenuItem onClick={() => onNavigate('/settings')} className="cursor-pointer">
              <AlertTriangle className="h-3.5 w-3.5 text-warning mr-2 shrink-0" />
              <span>Traefik Proxy: Offline</span>
            </DropdownMenuItem>
          )}
          {errorProjects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onClick={() => onNavigate(`/projects/${project.id}`)}
              className="cursor-pointer"
            >
              <AlertCircle className="h-3.5 w-3.5 text-error mr-2 shrink-0" />
              <span className="truncate">{project.name}: error</span>
              <span className="text-muted-ol text-[10px] ml-auto shrink-0">
                {formatRelativeTime(project.updatedAt, t)}
              </span>
            </DropdownMenuItem>
          ))}
          {isAllOk && (
            <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-body text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All systems operational
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
        <div className="p-2.5 bg-bg-subtle rounded-md">
          <Box className="h-5 w-5 text-primary-ol" />
        </div>
        <div>
          <p className="text-xs font-mono text-muted-ol mb-0.5">DOCKER ENGINE</p>
          <div className="flex items-center gap-1.5">
            {isDockerOk ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-error" />
            )}
            <span className="text-sm font-semibold text-primary-ol">
              {isDockerOk ? `${containerCount} Containers` : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
        <div className="p-2.5 bg-bg-subtle rounded-md">
          <Server className="h-5 w-5 text-primary-ol" />
        </div>
        <div>
          <p className="text-xs font-mono text-muted-ol mb-0.5">TRAEFIK PROXY</p>
          <div className="flex items-center gap-1.5">
            {isTraefikOk ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-error" />
            )}
            <span className="text-sm font-semibold text-primary-ol">
              {isTraefikOk ? 'Routing Active' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex items-center gap-4">
        <div className="p-2.5 bg-bg-subtle rounded-md">
          <ShieldCheck className="h-5 w-5 text-primary-ol" />
        </div>
        <div>
          <p className="text-xs font-mono text-muted-ol mb-0.5">AI RECOVERY</p>
          <div className="flex items-center gap-1.5">
            {isLlmOk ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-agent" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-warning" />
            )}
            <span className="text-sm font-semibold text-primary-ol">
              {isLlmOk ? 'Armed & Ready' : 'Not Configured'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
