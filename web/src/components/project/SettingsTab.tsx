import { type FormEvent, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/i18n/context';
import { archiveProject, purgeProject, unarchiveProject, updateProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Project } from '@/types';

type SettingsSection = 'general' | 'danger';
type ProjectDangerAction = 'archive' | 'unarchive' | 'purge';

interface SettingsTabProps {
  projectId: string;
  project?: Project | null;
  onProjectChanged?: () => void;
  onProjectDeleted?: () => void;
}

export function SettingsTab({
  projectId,
  project,
  onProjectChanged,
  onProjectDeleted,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [confirmAction, setConfirmAction] = useState<ProjectDangerAction | null>(null);
  const [actionLoading, setActionLoading] = useState<ProjectDangerAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const navItems: { id: SettingsSection; label: string }[] = [
    { id: 'general', label: t('settings.nav.general') },
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
        {activeSection === 'general' && (
          <ProjectGeneralPanel project={project} onProjectChanged={onProjectChanged} />
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

function ProjectGeneralPanel({
  project,
  onProjectChanged,
}: {
  project?: Project | null;
  onProjectChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState(project?.displayName ?? project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [tags, setTags] = useState((project?.tags ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(project?.displayName ?? project?.name ?? '');
    setDescription(project?.description ?? '');
    setTags((project?.tags ?? []).join(', '));
  }, [project?.description, project?.displayName, project?.name, project?.tags]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project) return;

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError(t('settings.general.displayNameRequired'));
      return;
    }

    const parsedTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateProject(project.id, {
        displayName: trimmedName,
        description: description.trim() || null,
        tags: [...new Set(parsedTags)],
      });
      setMessage(t('settings.general.saved'));
      onProjectChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.general.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t('settings.general.title')}</h3>
        <p className="mt-1 text-xs text-foreground/70">{t('settings.general.description')}</p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/80">
          {t('settings.general.displayName')}
        </span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2 text-sm text-foreground outline-none focus:border-agent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/80">{t('settings.general.slug')}</span>
        <input
          value={project?.name ?? ''}
          readOnly
          className="ol-mono cursor-not-allowed rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 py-2 text-xs text-foreground/70"
        />
        <span className="text-[11px] text-foreground/60">{t('settings.general.slugHelp')}</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/80">
          {t('settings.general.projectDescription')}
        </span>
        <textarea
          value={description ?? ''}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2 text-sm text-foreground outline-none focus:border-agent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-foreground/80">{t('settings.general.tags')}</span>
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t('settings.general.tagsPlaceholder')}
          className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 py-2 text-sm text-foreground outline-none focus:border-agent"
        />
      </label>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
          {message}
        </div>
      )}

      <div>
        <Button type="submit" size="sm" disabled={saving || !project}>
          {saving ? t('settings.general.saving') : t('settings.general.save')}
        </Button>
      </div>
    </form>
  );
}
