/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * Lint note: reads `project.status` / `project.visibility` off the typed
 * wire shape exposed by `@/lib/api`, not the dropped DB columns. The
 * wire layer aliases the dropped projects.* columns from the underlying
 * services row (post-migration 0012) until consumers migrate to
 * getDeployableForProject(projectId). The no-dropped-columns rule is
 * name-based and would misfire here.
 */
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
import { getStatusDisplay } from '@/lib/status-config';
import { useLanguage } from '@/i18n/context';
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

function buildStatusConfig(
  t: (key: string) => string,
  isImageSource: boolean = false,
): Record<string, StatusConfig> {
  const labels: Record<string, string> = {
    running: t('project.header.status.live'),
    stopped: t('project.header.status.stopped'),
    building: isImageSource
      ? t('project.header.status.pulling')
      : t('project.header.status.deploying'),
    error: t('project.header.status.failed'),
    idle: t('project.header.status.idle'),
  };
  const out: Record<string, StatusConfig> = {};
  for (const key of Object.keys(labels)) {
    const def = getStatusDisplay(key);
    out[key] = { label: labels[key], color: def.textClass, dot: def.dot };
  }
  return out;
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
  const { t } = useLanguage();
  const isImageSource = project.source === 'image';
  const statusConfig = buildStatusConfig(t, isImageSource);

  const displayStatus = project.status;
  const displayPublicUrl = project.publicUrl;
  const isPartiallyArchived =
    project.partiallyArchived === true || project.partially_archived === true;

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
          {isImageSource
            ? t('project.header.action.pulling')
            : t('project.header.action.deploying')}
        </Button>
      );
    }
    if (isStopped && !hasContainer) {
      return (
        <Tooltip content={t('project.header.action.pipelineTooltip')} side="bottom">
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
                <Zap className="h-3 w-3" />
              </>
            )}
            {t('project.header.action.deploy')}
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
          {t('project.header.action.start')}
        </Button>
      );
    }
    // running or error → Redeploy or Pull & Restart for image source
    return (
      <Tooltip content={t('project.header.action.pipelineTooltip')} side="bottom">
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
              {isImageSource ? <Download className="h-3 w-3" /> : <RotateCw className="h-3 w-3" />}
            </>
          )}
          {isImageSource
            ? t('project.header.action.pullRestart')
            : t('project.header.action.redeploy')}
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
              <h1 className="font-display font-bold text-lg text-foreground tracking-tight truncate">
                {project.displayName ?? project.name}
              </h1>
              {isPartiallyArchived && (
                <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[10.5px] font-medium text-warning">
                  {t('projects.card.partiallyArchivedBadge')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs font-body text-foreground/80">
              <span className={status.color}>{status.label}</span>
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
              {t('project.header.action.stop')}
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
              ? t('project.header.share.shared')
              : project.visibility === 'quick-share'
                ? t('project.header.share.exposed')
                : t('project.header.share.share')}
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
                <span className="sr-only">{t('project.header.action.more')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Redeploy (if not already primary) */}
              {isStopped && (
                <DropdownMenuItem onClick={onRedeploy} disabled={!!actionLoading}>
                  <RotateCw className="h-3.5 w-3.5 mr-2" />
                  {t('project.header.action.redeploy')}
                </DropdownMenuItem>
              )}

              {/* Rollback */}
              <DropdownMenuItem onClick={onRollback} disabled={!!actionLoading}>
                <History className="h-3.5 w-3.5 mr-2" />
                {t('project.header.action.rollback')}
              </DropdownMenuItem>

              {/* Blue-Green */}
              <Tooltip content={t('project.header.action.pipelineTooltip')} side="bottom">
                <DropdownMenuItem
                  onClick={onOpenBlueGreenDialog}
                  disabled={!isRunning || !!actionLoading}
                >
                  <Zap className="h-3.5 w-3.5 mr-2" />
                  {t('project.header.action.blueGreen')}
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
                  {t('project.header.action.stop')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onStart} disabled={!!actionLoading || isBuilding}>
                  <Play className="h-3.5 w-3.5 mr-2" />
                  {t('project.header.action.start')}
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
                  {t(
                    isPartiallyArchived
                      ? 'projects.archive.remainingButton'
                      : 'projects.archive.button',
                  )}
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
