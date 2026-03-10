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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

interface ProjectHeaderProps {
  project: Project;
  actionLoading: string | null;
  onRedeploy: () => void;
  onStop: () => void;
  onStart: () => void;
  onRollback: () => void;
  onBlueGreen: () => void;
  onShare: () => void;
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(): Record<string, StatusConfig> {
  return {
    running: { label: 'Live', color: 'text-success', dot: 'bg-success' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    building: { label: 'Deploying', color: 'text-warning', dot: 'bg-warning animate-pulse' },
    error: { label: 'Failed', color: 'text-error', dot: 'bg-error' },
  };
}

export function ProjectHeader({
  project,
  actionLoading,
  onRedeploy,
  onStop,
  onStart,
  onRollback,
  onBlueGreen,
  onShare,
}: ProjectHeaderProps) {
  const statusConfig = getStatusConfig();
  const status = statusConfig[project.status] ?? statusConfig.stopped;
  const isBuilding = project.status === 'building';
  const isRunning = project.status === 'running';
  const isStopped = project.status === 'stopped';

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
        {/* Project info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
          <div className="min-w-0">
            <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
              {project.name}
            </h1>
            <div className="flex items-center gap-3 mt-0.5 text-[11px] font-body text-secondary-ol">
              <span className={status.color}>{status.label}</span>
              {project.branch && (
                <span className="flex items-center gap-1 text-muted-ol">
                  <GitBranch className="h-3 w-3" />
                  {project.branch}
                </span>
              )}
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-agent hover:text-agent/80 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {project.url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
            {project.publicUrl && (
              <a
                href={project.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-success hover:text-success/80 transition-colors text-[11px] font-body mt-0.5"
              >
                <Globe className="h-3 w-3" />
                {project.publicUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Action area */}
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
              <DropdownMenuItem onClick={onBlueGreen} disabled={!isRunning || !!actionLoading}>
                <Zap className="h-3.5 w-3.5 mr-2" />
                Blue-Green Deploy
              </DropdownMenuItem>

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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
