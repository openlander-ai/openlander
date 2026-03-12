import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ExternalLink,
  RotateCw,
  Play,
  Square,
  GitBranch,
  Globe,
  Share2,
  GlobeLock,
  History,
  Zap,
  MoreHorizontal,
  ChevronDown,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project, Environment, EnvironmentType } from '@/types';

interface ProjectHeaderProps {
  project: Project;
  environments?: Environment[];
  currentEnvType?: EnvironmentType;
  onEnvChange?: (env: EnvironmentType) => void;
  onAddEnv?: (env: EnvironmentType) => void;
  actionLoading: string | null;
  onRedeploy: () => void;
  onStop: () => void;
  onStart: () => void;
  onRollback: () => void;
  onBlueGreen: () => void;
  onShare: () => void;
  onDelete: () => void;
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(): Record<string, StatusConfig> {
  return {
    running: { label: 'Live', color: 'text-success', dot: 'bg-success' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    building: { label: 'Deploying', color: 'text-warning', dot: 'bg-warning animate-pulse' },
    error: { label: 'Failed', color: 'text-error', dot: 'bg-error' },
    idle: { label: 'Idle', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
  };
}

export function ProjectHeader({
  project,
  environments = [],
  currentEnvType = 'production',
  onEnvChange,
  onAddEnv,
  actionLoading,
  onRedeploy,
  onStop,
  onStart,
  onRollback,
  onBlueGreen,
  onShare,
  onDelete,
}: ProjectHeaderProps) {
  const statusConfig = getStatusConfig();

  const selectedEnv = environments.find((e) => e.type === currentEnvType);
  const displayStatus = selectedEnv ? selectedEnv.status : project.status;
  const displayBranch = selectedEnv ? selectedEnv.branch : project.branch;
  const displayPublicUrl = selectedEnv ? selectedEnv.publicUrl : project.publicUrl;
  const displayUrl = currentEnvType === 'production' ? project.url : undefined;

  const status = statusConfig[displayStatus] ?? statusConfig.stopped;
  const isBuilding = displayStatus === 'building';
  const isRunning = displayStatus === 'running';
  const isStopped = displayStatus === 'stopped' || displayStatus === 'idle';

  const envColors: Record<EnvironmentType, string> = {
    production: 'bg-success/10 text-success border-success/20',
    staging: 'bg-warning/10 text-warning border-warning/20',
    development: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  };

  const envLabels: Record<EnvironmentType, string> = {
    production: 'Production',
    staging: 'Staging',
    development: 'Development',
  };

  // Determine primary action
  const renderPrimaryAction = () => {
    if (isBuilding) {
      return (
        <Button variant="outline" size="sm" className="h-7 text-[11px] font-body gap-1.5" disabled>
          <Spinner className="h-3 w-3" />
          Deploying...
        </Button>
      );
    }
    if (isStopped) {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] font-body gap-1.5 text-success hover:text-success hover:bg-success/10 hover:border-success/30"
          onClick={onStart}
          disabled={!!actionLoading}
        >
          {actionLoading === 'start' ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Start
        </Button>
      );
    }
    // running or error → Redeploy
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-[11px] font-body gap-1.5"
        onClick={onRedeploy}
        disabled={!!actionLoading}
      >
        {actionLoading === 'redeploy' ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <RotateCw className="h-3 w-3" />
        )}
        Redeploy
      </Button>
    );
  };

  const isShared = project.visibility === 'shared' || project.visibility === 'quick-share';

  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
                {project.name}
              </h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-6 px-2 text-[11px] font-body gap-1 border',
                      envColors[currentEnvType],
                    )}
                  >
                    {envLabels[currentEnvType]}
                    <ChevronDown className="h-3 w-3 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {(['production', 'staging', 'development'] as EnvironmentType[]).map((env) => {
                    const exists = env === 'production' || environments.some((e) => e.type === env);
                    return (
                      <DropdownMenuItem
                        key={env}
                        onClick={() => {
                          if (exists) {
                            onEnvChange?.(env);
                          } else {
                            onAddEnv?.(env);
                          }
                        }}
                        className="flex items-center justify-between"
                      >
                        <span className={cn('text-xs', env === currentEnvType && 'font-medium')}>
                          {envLabels[env]}
                        </span>
                        {!exists && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-ol">
                            <Plus className="h-3 w-3" />
                            Add
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] font-body text-secondary-ol">
              <span className={status.color}>{status.label}</span>
              {displayBranch && (
                <span className="flex items-center gap-1 text-muted-ol">
                  <GitBranch className="h-3 w-3" />
                  {displayBranch}
                </span>
              )}
              {displayUrl && (
                <a
                  href={displayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-agent hover:text-agent/80 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {displayUrl.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            {displayPublicUrl && (
              <a
                href={displayPublicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-success hover:text-success/80 transition-colors text-[11px] font-body mt-0.5"
              >
                <Globe className="h-3 w-3" />
                {displayPublicUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Primary action */}
          {renderPrimaryAction()}

          {/* Stop button (when running) */}
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] font-body gap-1.5 text-error hover:text-error hover:bg-error/10 hover:border-error/30"
              onClick={onStop}
              disabled={!!actionLoading}
            >
              {actionLoading === 'stop' ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              Stop
            </Button>
          )}

          {/* Share button */}
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 text-[11px] font-body gap-1.5',
              isShared ? 'text-agent hover:text-agent hover:bg-agent/10 hover:border-agent/30' : '',
            )}
            onClick={onShare}
            disabled={project.status !== 'running' || !!actionLoading}
          >
            {isShared ? <GlobeLock className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
            {project.visibility === 'shared'
              ? 'Shared'
              : project.visibility === 'quick-share'
                ? 'Exposed'
                : 'Share'}
          </Button>

          {/* ⋯ More actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 font-body"
                disabled={!!actionLoading}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="sr-only">More actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Redeploy (if not already primary) */}
              {isStopped && (
                <DropdownMenuItem onClick={onRedeploy} disabled={!!actionLoading}>
                  <RotateCw className="h-3.5 w-3.5 mr-2" />
                  Redeploy
                </DropdownMenuItem>
              )}

              {/* Rollback */}
              <DropdownMenuItem
                onClick={onRollback}
                disabled={!project.previousImageTag || !!actionLoading}
              >
                <History className="h-3.5 w-3.5 mr-2" />
                Rollback
              </DropdownMenuItem>

              {/* Blue-Green */}
              {currentEnvType === 'production' && (
                <DropdownMenuItem onClick={onBlueGreen} disabled={!isRunning || !!actionLoading}>
                  <Zap className="h-3.5 w-3.5 mr-2" />
                  Blue-Green Deploy
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {/* Start/Stop toggle */}
              {isRunning ? (
                <DropdownMenuItem
                  onClick={onStop}
                  disabled={!!actionLoading}
                  className="text-error focus:text-error"
                >
                  <Square className="h-3.5 w-3.5 mr-2" />
                  Stop
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onStart} disabled={!!actionLoading || isBuilding}>
                  <Play className="h-3.5 w-3.5 mr-2" />
                  Start
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {/* Delete */}
              <DropdownMenuItem
                onClick={onDelete}
                disabled={!!actionLoading}
                className="text-error focus:text-error"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete {currentEnvType === 'production' ? 'Project' : 'Environment'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
