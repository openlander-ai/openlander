import { useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { EnvVarsTable } from '@/components/config/EnvVarsTable';
import { DomainsPanel } from '@/components/config/DomainsPanel';
import { WebhookPanel } from '@/components/config/WebhookPanel';
import { DeploymentSourcePanel } from '@/components/project/DeploymentSourcePanel';
import { ResourceLimitsPanel } from '@/components/config/ResourceLimitsPanel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/i18n/context';
import { archiveProject, purgeProject, unarchiveProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

type SettingsSection = 'source' | 'env' | 'domains' | 'webhooks' | 'resources' | 'danger';
type ProjectDangerAction = 'archive' | 'unarchive' | 'purge';

interface SettingsTabProps {
  projectId: string;
  project?: Project | null;
  projectStatus?: string;
  isCompose?: boolean;
  onProjectChanged?: () => void;
  onProjectDeleted?: () => void;
}

export function SettingsTab({
  projectId,
  project,
  projectStatus,
  isCompose,
  onProjectChanged,
  onProjectDeleted,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<SettingsSection>('source');
  const [confirmAction, setConfirmAction] = useState<ProjectDangerAction | null>(null);
  const [actionLoading, setActionLoading] = useState<ProjectDangerAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const navItems: { id: SettingsSection; label: string }[] = [
    { id: 'source', label: t('settings.nav.source') },
    { id: 'env', label: t('settings.nav.env') },
    { id: 'domains', label: t('settings.nav.domains') },
    { id: 'webhooks', label: t('settings.nav.webhooks') },
    { id: 'resources', label: t('resources.title') },
    { id: 'danger', label: t('projectDetail.danger.nav') },
  ];

  const runProjectAction = async (action: ProjectDangerAction) => {
    setActionError(null);
    setActionLoading(action);
    try {
      if (action === 'archive') {
        await archiveProject(projectId);
        onProjectChanged?.();
      } else if (action === 'unarchive') {
        await unarchiveProject(projectId);
        onProjectChanged?.();
      } else {
        await purgeProject(projectId);
        onProjectDeleted?.();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('projectDetail.danger.error'));
    } finally {
      setActionLoading(null);
    }
  };

  const confirmCopy =
    confirmAction === 'archive'
      ? {
          title: t('projects.archive.button'),
          description: t('projects.archive.description'),
          confirmLabel: t('projects.archive.button'),
          variant: 'default' as const,
        }
      : confirmAction === 'unarchive'
        ? {
            title: t('projects.unarchive.button'),
            description: t('projectDetail.danger.unarchiveDescription'),
            confirmLabel: t('projects.unarchive.button'),
            variant: 'default' as const,
          }
        : {
            title: t('projects.purge.title'),
            description: t('projectDetail.danger.purgeDescription'),
            confirmLabel: t('projects.purge.confirm'),
            variant: 'destructive' as const,
          };

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0 overflow-hidden">
      {/* Left nav: horizontal on mobile, vertical on desktop */}
      <div className="shrink-0 md:w-48 border-b md:border-b-0 md:border-r border-[hsl(var(--border))] bg-bg-panel">
        {/* Mobile: horizontal scroll row */}
        <div className="flex md:hidden overflow-x-auto px-3 py-2 gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-md text-xs font-body transition-colors whitespace-nowrap',
                activeSection === item.id
                  ? 'bg-bg-subtle text-foreground font-medium'
                  : 'text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Desktop: vertical list */}
        <div className="hidden md:flex flex-col p-3 gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-xs font-body transition-colors',
                activeSection === item.id
                  ? 'bg-bg-subtle text-foreground font-medium'
                  : 'text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right pane: settings form */}
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {activeSection === 'source' && <DeploymentSourcePanel projectId={projectId} />}
        {activeSection === 'env' && <EnvVarsTable projectId={projectId} />}
        {activeSection === 'domains' && (
          <DomainsPanel projectId={projectId} projectStatus={projectStatus} />
        )}
        {activeSection === 'webhooks' && <WebhookPanel projectId={projectId} />}
        {activeSection === 'resources' && (
          <ResourceLimitsPanel projectId={projectId} isCompose={isCompose} />
        )}
        {activeSection === 'danger' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('projectDetail.danger.title')}
              </h3>
              <p className="mt-1 text-xs text-foreground/70">
                {t('projectDetail.danger.description')}
              </p>
            </div>

            {actionError && (
              <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                {actionError}
              </div>
            )}

            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-medium text-foreground">
                    {project?.archived_at
                      ? t('projectDetail.danger.restoreTitle')
                      : t('projectDetail.danger.archiveTitle')}
                  </h4>
                  <p className="mt-1 text-xs text-foreground/70">
                    {project?.archived_at
                      ? t('projectDetail.danger.restoreBody')
                      : t('projectDetail.danger.archiveBody')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!actionLoading}
                  onClick={() => setConfirmAction(project?.archived_at ? 'unarchive' : 'archive')}
                >
                  {project?.archived_at ? (
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  ) : (
                    <Archive className="h-3.5 w-3.5" />
                  )}
                  {project?.archived_at
                    ? t('projects.unarchive.button')
                    : t('projects.archive.button')}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-error/30 bg-error/5 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-medium text-error">
                    {t('projectDetail.danger.deleteTitle')}
                  </h4>
                  <p className="mt-1 text-xs text-foreground/70">
                    {t('projectDetail.danger.deleteBody')}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!!actionLoading}
                  onClick={() => setConfirmAction('purge')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('projects.purge.button')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        variant={confirmCopy.variant}
        onConfirm={() => {
          if (confirmAction) void runProjectAction(confirmAction);
        }}
      />
    </div>
  );
}
