import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
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
  Trash2,
  Download,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSetup } from '@/hooks/use-setup.js';
import { useLanguage } from '@/i18n/context';
import { AISparkle } from '@/components/ui/AISparkle';
import { DomainUrlDisplay } from './DomainUrlDisplay';
import type { Project } from '@/types';

interface ProjectHeaderProps {
  project: Project;
  actionLoading: string | null;
  onRedeploy: () => void;
  onStop: () => void;
  onStart: () => void;
  onRollback: () => void;
  onOpenBlueGreenDialog: () => void;
  onShare: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onPurge: () => void;
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(isImageSource: boolean = false): Record<string, StatusConfig> {
  return {
    running: { label: 'Live', color: 'text-success', dot: 'bg-success animate-pulse' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    building: {
      label: isImageSource ? 'Pulling' : 'Deploying',
      color: 'text-warning',
      dot: 'bg-warning animate-pulse-ring',
    },
    error: { label: 'Failed', color: 'text-error', dot: 'bg-error' },
    idle: { label: 'Idle', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
  };
}

export function ProjectHeader({
  project,
  actionLoading,
  onRedeploy,
  onStop,
  onStart,
  onRollback,
  onOpenBlueGreenDialog,
  onShare,
  onArchive,
  onUnarchive,
  onPurge,
}: ProjectHeaderProps) {
  const { status: setupStatus } = useSetup();
  const { t } = useLanguage();
  const isImageSource = project.source === 'image';
  const statusConfig = getStatusConfig(isImageSource);
  const isLlmConfigured = setupStatus?.llm.ok === true;

  const displayStatus = project.status;
  const displayBranch = project.branch;
  const displayPublicUrl = project.publicUrl;

  const status = statusConfig[displayStatus] ?? statusConfig.stopped;
  const isBuilding = displayStatus === 'building';
  const isRunning = displayStatus === 'running';
  const isStopped = displayStatus === 'stopped' || displayStatus === 'idle';
  const hasContainer = !!project.port;

  // Determine primary action
  const renderPrimaryAction = () => {
    if (isBuilding) {
      return (
        <Button variant="outline" size="sm" className="h-7 text-xs font-body gap-1.5" disabled>
          <Spinner className="h-3 w-3" />
          {isImageSource ? 'Pulling...' : 'Deploying...'}
        </Button>
      );
    }
    if (isStopped && !hasContainer) {
      return (
        <Tooltip content="AI가 전체 파이프라인을 처리합니다" side="bottom">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-body gap-1.5 text-agent hover:text-agent hover:bg-agent/10 hover:border-agent/30"
            onClick={onRedeploy}
            disabled={!!actionLoading}
          >
            {actionLoading === 'redeploy' ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <>
                {isLlmConfigured && <AISparkle className="h-3.5 w-3.5" />}
                <Zap className="h-3 w-3" />
              </>
            )}
            Deploy
          </Button>
        </Tooltip>
      );
    }
    if (isStopped) {
      return (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-body gap-1.5 text-success hover:text-success hover:bg-success/10 hover:border-success/30"
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
    // running or error → Redeploy or Pull & Restart for image source
    return (
      <Tooltip content="AI가 전체 파이프라인을 처리합니다" side="bottom">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-body gap-1.5"
          onClick={onRedeploy}
          disabled={!!actionLoading}
        >
          {actionLoading === 'redeploy' ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <>
              {isLlmConfigured && <AISparkle className="h-3.5 w-3.5" />}
              {isImageSource ? <Download className="h-3 w-3" /> : <RotateCw className="h-3 w-3" />}
            </>
          )}
          {isImageSource ? 'Pull & Restart' : 'Redeploy'}
        </Button>
      </Tooltip>
    );
  };

  const isShared = project.visibility === 'shared' || project.visibility === 'quick-share';

  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
                {project.name}
              </h1>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs font-body text-secondary-ol">
              <span className={status.color}>{status.label}</span>
              {displayBranch && (
                <span className="flex items-center gap-1 text-muted-ol">
                  <GitBranch className="h-3 w-3" />
                  {displayBranch}
                </span>
              )}
              <DomainUrlDisplay publicUrl={displayPublicUrl} urls={project.urls} />
            </div>
            {displayPublicUrl && (
              <a
                href={displayPublicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-success hover:text-success/80 transition-colors text-xs font-body mt-0.5"
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
              className="h-7 text-xs font-body gap-1.5 text-error hover:text-error hover:bg-error/10 hover:border-error/30"
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
              'h-7 text-xs font-body gap-1.5',
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
              <DropdownMenuItem onClick={onRollback} disabled={!!actionLoading}>
                <div className="flex items-center gap-2">
                  {isLlmConfigured && <AISparkle className="h-3.5 w-3.5" />}
                  <History className="h-3.5 w-3.5" />
                </div>
                Rollback
              </DropdownMenuItem>

              {/* Blue-Green */}
              <Tooltip content="AI가 전체 파이프라인을 처리합니다" side="bottom">
                <DropdownMenuItem
                  onClick={onOpenBlueGreenDialog}
                  disabled={!isRunning || !!actionLoading}
                >
                  <div className="flex items-center gap-2">
                    {isLlmConfigured && <AISparkle className="h-3.5 w-3.5" />}
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  Blue-Green Deploy
                </DropdownMenuItem>
              </Tooltip>

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

              {!project.archived_at ? (
                <DropdownMenuItem
                  onClick={onArchive}
                  disabled={!!actionLoading}
                  className="text-warning focus:text-warning"
                >
                  <Archive className="h-3.5 w-3.5 mr-2" />
                  {t('projects.archive.button')}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={onUnarchive} disabled={!!actionLoading}>
                    <ArchiveRestore className="h-3.5 w-3.5 mr-2" />
                    {t('projects.unarchive.button')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={onPurge}
                    disabled={!!actionLoading}
                    className="text-error focus:text-error"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    {t('projects.purge.button')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
