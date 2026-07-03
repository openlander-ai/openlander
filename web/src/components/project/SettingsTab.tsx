import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Archive,
  ArchiveRestore,
  Database,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { AiOpsBriefingPanel } from '@/components/ai-ops/AiOpsBriefingPanel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/i18n/context';
import {
  archiveProject,
  deleteGroupService,
  listGroupServices,
  purgeProject,
  unarchiveGroupService,
  unarchiveProject,
  updateProject,
  type GroupService,
} from '@/lib/api';
import {
  listProjectDataSources,
  updateDataSourceAccess,
  type DataSourceSummary,
} from '@/lib/api/data-access';
import { cn } from '@/lib/utils';
import type { ServiceHealth } from '@/lib/projectTopology';
import type { Project } from '@/types';

export type SettingsSection = 'general' | 'ai' | 'data' | 'danger';
type ProjectDangerAction = 'archive' | 'unarchive' | 'purge';

interface SettingsTabProps {
  projectId: string;
  project?: Project | null;
  initialSection?: SettingsSection;
  resourceHealthById?: Record<string, ServiceHealth>;
  onOpenAiOps?: () => void;
  onProjectChanged?: () => void;
  onProjectDeleted?: () => void;
}

export function SettingsTab({
  projectId,
  project,
  initialSection = 'general',
  resourceHealthById,
  onOpenAiOps,
  onProjectChanged,
  onProjectDeleted,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [confirmAction, setConfirmAction] = useState<ProjectDangerAction | null>(null);
  const [actionLoading, setActionLoading] = useState<ProjectDangerAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dangerRefreshKey, setDangerRefreshKey] = useState(0);
  const isPartiallyArchived =
    project?.partiallyArchived === true || project?.partially_archived === true;

  const navItems: { id: SettingsSection; label: string }[] = [
    { id: 'general', label: t('settings.nav.general') },
    { id: 'ai', label: t('settings.nav.ai') },
    { id: 'data', label: t('settings.nav.data') },
    { id: 'danger', label: t('projectDetail.danger.nav') },
  ];

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const runProjectAction = async (action: ProjectDangerAction) => {
    setActionError(null);
    setActionLoading(action);
    try {
      if (action === 'archive') {
        await archiveProject(projectId);
        setDangerRefreshKey((value) => value + 1);
        onProjectChanged?.();
      } else if (action === 'unarchive') {
        await unarchiveProject(projectId);
        setDangerRefreshKey((value) => value + 1);
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
          title: t(
            isPartiallyArchived ? 'projects.archive.remainingButton' : 'projects.archive.button',
          ),
          description: t(
            isPartiallyArchived
              ? 'projects.archive.remainingDescription'
              : 'projects.archive.description',
          ),
          confirmLabel: t(
            isPartiallyArchived ? 'projects.archive.remainingButton' : 'projects.archive.button',
          ),
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
        {activeSection === 'ai' && (
          <ProjectAiOpsPanel projectId={projectId} onOpenAiOps={onOpenAiOps} />
        )}
        {activeSection === 'data' && (
          <ProjectDataAccessPanel projectId={projectId} resourceHealthById={resourceHealthById} />
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
                      : isPartiallyArchived
                        ? t('projectDetail.danger.partialArchiveTitle')
                        : t('projectDetail.danger.archiveTitle')}
                  </h4>
                  <p className="mt-1 text-xs text-foreground/70">
                    {project?.archived_at
                      ? t('projectDetail.danger.restoreBody')
                      : isPartiallyArchived
                        ? t('projectDetail.danger.partialArchiveBody')
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
                    : isPartiallyArchived
                      ? t('projects.archive.remainingButton')
                      : t('projects.archive.button')}
                </Button>
              </div>
            </div>

            <ArchivedServicesDangerPanel
              projectId={projectId}
              projectName={project?.name ?? ''}
              refreshKey={dangerRefreshKey}
              onProjectChanged={onProjectChanged}
            />

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

function ArchivedServicesDangerPanel({
  projectId,
  projectName,
  refreshKey,
  onProjectChanged,
}: {
  projectId: string;
  projectName: string;
  refreshKey: number;
  onProjectChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [services, setServices] = useState<GroupService[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteVolumes, setDeleteVolumes] = useState(false);

  const loadArchivedServices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const allServices = await listGroupServices(projectId, { includeArchived: true });
      setServices(allServices.filter((service) => service.archivedAt != null));
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : t('projectDetail.danger.archivedServicesLoadError'),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadArchivedServices();
  }, [loadArchivedServices, refreshKey]);

  const resetDeleteState = () => {
    setDeleteTargetId(null);
    setDeleteConfirmation('');
    setDeleteVolumes(false);
    setActionError(null);
  };

  const restoreService = async (service: GroupService) => {
    setActionKey(`restore:${service.id}`);
    setActionError(null);
    try {
      await unarchiveGroupService(projectId, service.id);
      resetDeleteState();
      await loadArchivedServices();
      onProjectChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('projectDetail.serviceRestore.error'));
    } finally {
      setActionKey(null);
    }
  };

  const deleteService = async (service: GroupService, expectedSlug: string) => {
    if (!expectedSlug || deleteConfirmation.trim() !== expectedSlug) return;
    setActionKey(`delete:${service.id}`);
    setActionError(null);
    try {
      await deleteGroupService(projectId, service.id, {
        confirmation: deleteConfirmation.trim(),
        deleteVolumes,
      });
      resetDeleteState();
      await loadArchivedServices();
      onProjectChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('projectDetail.serviceDelete.error'));
    } finally {
      setActionKey(null);
    }
  };

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-medium text-foreground">
          {t('projectDetail.danger.archivedServicesTitle')}
        </h4>
        <p className="text-xs text-foreground/70">
          {t('projectDetail.danger.archivedServicesBody')}
        </p>
      </div>

      {loadError && (
        <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {t('projectDetail.danger.archivedServicesLoadError')}: {loadError}
        </div>
      )}

      {actionError && (
        <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {actionError}
        </div>
      )}

      {loading ? (
        <p className="mt-3 text-xs text-foreground/60">
          {t('projectDetail.danger.archivedServicesLoading')}
        </p>
      ) : services.length === 0 ? (
        <p className="mt-3 text-xs text-foreground/60">
          {t('projectDetail.danger.archivedServicesEmpty')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {services.map((service) => {
            const expectedSlug = projectName ? `${projectName}/${service.name}` : '';
            const isDeleteOpen = deleteTargetId === service.id;
            const busy = actionKey != null;
            return (
              <div
                key={service.id}
                className="rounded-md border border-[hsl(var(--border))] bg-bg-subtle/30 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {service.name}
                      </span>
                      <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
                        {service.status}
                      </span>
                    </div>
                    <p className="ol-mono mt-1 break-all text-[11px] text-foreground/60">
                      {t('projectDetail.danger.archivedServiceId', { id: service.id })}
                    </p>
                    {service.archivedAt && (
                      <p className="mt-1 text-[11px] text-foreground/50">
                        {t('projectDetail.danger.archivedServiceArchivedAt', {
                          value: service.archivedAt,
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void restoreService(service)}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" />
                      {actionKey === `restore:${service.id}`
                        ? t('projectDetail.serviceRestore.restoring')
                        : t('projectDetail.danger.restoreService')}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setDeleteTargetId(service.id);
                        setDeleteConfirmation('');
                        setDeleteVolumes(false);
                        setActionError(null);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('projectDetail.danger.deleteService')}
                    </Button>
                  </div>
                </div>

                {isDeleteOpen && (
                  <div className="mt-3 rounded-md border border-error/30 bg-error/5 p-3">
                    <div className="flex flex-col gap-3">
                      <p className="text-xs text-foreground/70">
                        {t('projectDetail.danger.deleteArchivedServiceHint', {
                          slug: expectedSlug,
                        })}
                      </p>
                      <input
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        aria-label={t('projectDetail.danger.deleteArchivedServiceInputLabel', {
                          slug: expectedSlug,
                        })}
                        className="ol-mono w-full rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-error"
                        placeholder={expectedSlug}
                      />
                      <label className="flex items-start gap-2 text-xs text-foreground/70">
                        <input
                          type="checkbox"
                          checked={deleteVolumes}
                          onChange={(event) => setDeleteVolumes(event.target.checked)}
                          className="mt-0.5"
                        />
                        <span>{t('projectDetail.serviceDelete.deleteVolumes')}</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionKey === `delete:${service.id}`}
                          onClick={resetDeleteState}
                        >
                          {t('projectDetail.env.cancel')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={
                            actionKey != null ||
                            !expectedSlug ||
                            deleteConfirmation.trim() !== expectedSlug
                          }
                          onClick={() => void deleteService(service, expectedSlug)}
                        >
                          {actionKey === `delete:${service.id}`
                            ? t('projectDetail.serviceDelete.deleting')
                            : t('projectDetail.serviceDelete.confirmButton')}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectAiOpsPanel({
  projectId,
  onOpenAiOps,
}: {
  projectId: string;
  onOpenAiOps?: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <AiOpsBriefingPanel projectId={projectId} onViewBriefings={onOpenAiOps} />
    </div>
  );
}

function ProjectDataAccessPanel({
  projectId,
  resourceHealthById,
}: {
  projectId: string;
  resourceHealthById?: Record<string, ServiceHealth>;
}) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<DataSourceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enableTarget, setEnableTarget] = useState<DataSourceSummary | null>(null);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProjectDataSources(projectId);
      setSources(response.data_sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.data.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const setAccess = async (source: DataSourceSummary, mode: 'read' | 'disabled') => {
    if (!source.service_id) return;
    setActionKey(source.service_id);
    setError(null);
    try {
      const response = await updateDataSourceAccess(projectId, source.service_id, mode);
      setSources((current) =>
        current.map((candidate) =>
          candidate.data_source_id === response.data_source.data_source_id
            ? response.data_source
            : candidate,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.data.saveFailed'));
    } finally {
      setActionKey(null);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t('settings.data.title')}</h3>
        <p className="mt-1 text-xs text-foreground/70">{t('settings.data.description')}</p>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-agent" />
          <div>
            <h4 className="text-sm font-medium text-foreground">
              {t('settings.data.boundaryTitle')}
            </h4>
            <p className="mt-1 text-xs text-foreground/70">
              {t('settings.data.boundaryDescription')}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-foreground/60">{t('settings.data.loading')}</p>
      ) : sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-bg-panel p-4">
          <p className="text-sm font-medium text-foreground">{t('settings.data.emptyTitle')}</p>
          <p className="mt-1 text-xs text-foreground/70">{t('settings.data.emptyDescription')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sources.map((source) => {
            const busy = actionKey === source.service_id;
            const enabled = source.status === 'enabled';
            const external = source.source === 'external_env';
            const health = source.service_id ? resourceHealthById?.[source.service_id] : undefined;
            return (
              <div
                key={source.data_source_id}
                className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Database className="h-4 w-4 text-foreground/60" />
                      <span className="truncate text-sm font-medium text-foreground">
                        {source.name}
                      </span>
                      <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
                        {source.kind}
                      </span>
                      <span className="rounded-full border border-[hsl(var(--border))] bg-bg-subtle px-2 py-0.5 text-[10px] uppercase tracking-wide text-foreground/60">
                        {external
                          ? t('settings.data.relationship.external')
                          : t('settings.data.relationship.managed')}
                      </span>
                      {health && (
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                            health === 'crashed'
                              ? 'border-error/30 bg-error/10 text-error'
                              : health === 'deploying'
                                ? 'border-info/30 bg-info/10 text-info'
                                : 'border-success/30 bg-success/10 text-success',
                          )}
                        >
                          {t(`settings.data.health.${health}`)}
                        </span>
                      )}
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                          enabled
                            ? 'border border-success/30 bg-success/10 text-success'
                            : 'border border-[hsl(var(--border))] text-foreground/60',
                        )}
                      >
                        {enabled
                          ? t('settings.data.status.enabled')
                          : external
                            ? t('settings.data.status.external')
                            : t('settings.data.status.disabled')}
                      </span>
                    </div>
                    <p className="ol-mono mt-1 break-all text-[11px] text-foreground/60">
                      {source.service_id ?? source.env_key ?? source.data_source_id}
                    </p>
                    <p className="mt-1 text-xs text-foreground/70">
                      {external
                        ? t('settings.data.externalDescription')
                        : enabled
                          ? t('settings.data.enabledDescription')
                          : t('settings.data.disabledDescription')}
                    </p>
                    {!external && (
                      <>
                        <div className="mt-3 grid gap-x-4 gap-y-2 border-y border-[hsl(var(--border))] py-2 text-[11.5px] sm:grid-cols-3">
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                              <Database className="h-3.5 w-3.5 text-foreground/50" />
                              {t('settings.data.factScopeLabel')}
                            </div>
                            <p className="mt-1 text-foreground/55">
                              {t('settings.data.factScopeValue')}
                            </p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                              <KeyRound className="h-3.5 w-3.5 text-foreground/50" />
                              {t('settings.data.factCredentialLabel')}
                            </div>
                            <p className="mt-1 text-foreground/55">
                              {t('settings.data.factCredentialValue')}
                            </p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-foreground/80">
                              <Activity className="h-3.5 w-3.5 text-foreground/50" />
                              {t('settings.data.factAuditLabel')}
                            </div>
                            <p className="mt-1 text-foreground/55">
                              {t('settings.data.factAuditValue')}
                            </p>
                          </div>
                        </div>
                        <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-foreground/55">
                          {enabled
                            ? t('settings.data.auditHint')
                            : t('settings.data.enableWarning')}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            to={`/activity?project=${encodeURIComponent(projectId)}&type=data`}
                            className="text-[11.5px] font-medium text-agent hover:underline"
                          >
                            {t('settings.data.viewAudit')}
                          </Link>
                        </div>
                      </>
                    )}
                  </div>
                  {!external && source.service_id && (
                    <Button
                      variant={enabled ? 'outline' : 'default'}
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (enabled) {
                          void setAccess(source, 'disabled');
                        } else {
                          setEnableTarget(source);
                        }
                      }}
                    >
                      {!enabled && <LockKeyhole className="h-3.5 w-3.5" />}
                      {busy
                        ? t('settings.data.saving')
                        : enabled
                          ? t('settings.data.disable')
                          : t('settings.data.enable')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={enableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEnableTarget(null);
        }}
        title={t('settings.data.enableConfirmTitle')}
        description={t('settings.data.enableConfirmDescription', {
          name: enableTarget?.name ?? t('settings.data.title'),
        })}
        confirmLabel={t('settings.data.enableConfirm')}
        cancelLabel={t('projectDetail.env.cancel')}
        onConfirm={() => {
          if (enableTarget) void setAccess(enableTarget, 'read');
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
    <div className="flex max-w-2xl flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
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
          <span className="text-xs font-medium text-foreground/80">
            {t('settings.general.slug')}
          </span>
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
          <span className="text-xs font-medium text-foreground/80">
            {t('settings.general.tags')}
          </span>
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
    </div>
  );
}
