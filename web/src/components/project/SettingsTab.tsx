import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  Archive,
  ArchiveRestore,
  Database,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { AiOpsBriefingPanel } from '@/components/ai-ops/AiOpsBriefingPanel';
import { OperationPermissionsPanel } from '@/components/security/OperationPermissionsPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { localizeApiError } from '@/lib/localized-api-error';
import type { ServiceHealth } from '@/lib/projectTopology';
import type { Project } from '@/types';
import {
  getDeliverySettings,
  updateDeliverySettings,
  uploadDeliveryLogo,
  type DeliverySettings,
} from '@/lib/api/deliveries';

export type SettingsSection = 'general' | 'permissions' | 'delivery' | 'ai' | 'data' | 'danger';
type ProjectDangerAction = 'archive' | 'unarchive' | 'purge';
type SettingsDeliveryType = 'software_release' | 'artifact_delivery';
type SettingsGateType = 'review' | 'qa' | 'data' | 'custom';
type Translate = (key: string, params?: Record<string, string | number>) => string;
interface SettingsGateTemplate {
  gate_key: string;
  gate_type: SettingsGateType;
  label: string;
  required: boolean;
}

function archivedServiceStatusLabel(status: string, t: Translate): string {
  switch (status) {
    case 'running':
    case 'building':
    case 'error':
    case 'stopped':
    case 'idle':
      return t(`projects.status.${status}`);
    default:
      return t('projects.status.unknown');
  }
}

function dataSourceKindLabel(kind: DataSourceSummary['kind'], t: Translate): string {
  return t(`settings.data.kind.${kind}`);
}

const FALLBACK_GATE_TEMPLATES: Record<SettingsDeliveryType, SettingsGateTemplate[]> = {
  software_release: [
    { gate_key: 'review', gate_type: 'review', label: 'Review', required: true },
    { gate_key: 'qa', gate_type: 'qa', label: 'QA', required: true },
    { gate_key: 'data', gate_type: 'data', label: 'Data', required: false },
  ],
  artifact_delivery: [
    { gate_key: 'review', gate_type: 'review', label: 'Review', required: true },
    { gate_key: 'qa', gate_type: 'qa', label: 'QA', required: false },
    { gate_key: 'data', gate_type: 'data', label: 'Data', required: false },
  ],
};

function settingsGateTemplates(
  settings: DeliverySettings,
): Record<SettingsDeliveryType, SettingsGateTemplate[]> {
  const configured = settings.default_gates_json;
  const read = (type: SettingsDeliveryType): SettingsGateTemplate[] => {
    const value = configured[type];
    if (!Array.isArray(value)) return FALLBACK_GATE_TEMPLATES[type].map((gate) => ({ ...gate }));
    return value as SettingsGateTemplate[];
  };
  return {
    software_release: read('software_release'),
    artifact_delivery: read('artifact_delivery'),
  };
}

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
    { id: 'permissions', label: t('settings.nav.permissions') },
    { id: 'delivery', label: t('delivery.settings.nav') },
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
      setActionError(
        localizeApiError(err, t, 'projectDetail.danger.error', 'projectDetail.danger.codes'),
      );
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
        {activeSection === 'permissions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t('securityPermissions.projectTitle')}
              </h3>
              <p className="mt-1 text-xs text-foreground/70">
                {t('securityPermissions.projectDescription')}
              </p>
            </div>
            <OperationPermissionsPanel scope="project" targetId={projectId} />
          </div>
        )}
        {activeSection === 'delivery' && <DeliverySettingsPanel projectId={projectId} />}
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

function DeliverySettingsPanel({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  useEffect(() => {
    let active = true;
    getDeliverySettings(projectId)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((err) => {
        if (active) {
          setError(
            localizeApiError(err, t, 'delivery.settings.loadError', 'delivery.errors.codes'),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, t]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setSettings(
        await updateDeliverySettings(projectId, {
          organization_name: settings.organization_name,
          document_name: settings.document_name,
          primary_color: settings.primary_color,
          footer_text: settings.footer_text,
          locale: settings.locale,
          default_gates_json: settings.default_gates_json,
        }),
      );
      setMessage(t('delivery.settings.saved'));
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.settings.saveError', 'delivery.errors.codes'));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async () => {
    if (!logoFile) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      setSettings(await uploadDeliveryLogo(projectId, logoFile));
      setLogoFile(null);
      setMessage(t('delivery.settings.logoSaved'));
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.settings.logoError', 'delivery.errors.codes'));
    } finally {
      setSaving(false);
    }
  };

  const setDefaultGateRequired = (
    deliveryType: SettingsDeliveryType,
    gateKey: string,
    required: boolean,
  ) => {
    if (!settings) return;
    const templates = settingsGateTemplates(settings);
    templates[deliveryType] = templates[deliveryType].map((gate) =>
      gate.gate_key === gateKey ? { ...gate, required } : gate,
    );
    setSettings({ ...settings, default_gates_json: templates });
  };

  if (!settings && !error) {
    return <p className="text-xs text-foreground/70">{t('delivery.loading')}</p>;
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-[color:var(--ol-primary-soft)] p-2 text-[color:var(--ol-primary)]">
          <FileCheck2 className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('delivery.settings.title')}</h3>
          <p className="mt-1 text-xs leading-5 text-foreground/70">
            {t('delivery.settings.description')}
          </p>
        </div>
      </div>

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

      {settings && (
        <div className="grid gap-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="receipt-organization" className="text-xs font-medium">
              {t('delivery.settings.organization')}
            </label>
            <Input
              id="receipt-organization"
              className="mt-1.5"
              value={settings.organization_name ?? ''}
              onChange={(event) =>
                setSettings({ ...settings, organization_name: event.target.value || null })
              }
            />
          </div>
          <div>
            <label htmlFor="receipt-document-name" className="text-xs font-medium">
              {t('delivery.settings.documentName')}
            </label>
            <Input
              id="receipt-document-name"
              className="mt-1.5"
              value={settings.document_name}
              onChange={(event) => setSettings({ ...settings, document_name: event.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="receipt-primary-color" className="text-xs font-medium">
              {t('delivery.settings.primaryColor')}
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="receipt-primary-color"
                type="color"
                value={settings.primary_color}
                onChange={(event) =>
                  setSettings({ ...settings, primary_color: event.target.value })
                }
                className="h-9 w-12 rounded border border-[hsl(var(--border))] bg-transparent p-1"
              />
              <Input
                value={settings.primary_color}
                onChange={(event) =>
                  setSettings({ ...settings, primary_color: event.target.value })
                }
                pattern="^#[0-9A-Fa-f]{6}$"
              />
            </div>
          </div>
          <div>
            <label htmlFor="receipt-locale" className="text-xs font-medium">
              {t('delivery.settings.locale')}
            </label>
            <select
              id="receipt-locale"
              value={settings.locale}
              onChange={(event) =>
                setSettings({ ...settings, locale: event.target.value as 'ko' | 'en' })
              }
              className="mt-1.5 h-9 w-full rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 text-xs"
            >
              <option value="ko">{t('delivery.settings.korean')}</option>
              <option value="en">{t('delivery.settings.english')}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="receipt-logo" className="text-xs font-medium">
              {t('delivery.settings.logo')}
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <Input
                id="receipt-logo"
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!logoFile || saving}
                onClick={() => void uploadLogo()}
              >
                {t('delivery.settings.uploadLogo')}
              </Button>
            </div>
            {settings.logo_blob_id && (
              <p className="ol-mono mt-1 truncate text-[10px] text-foreground/60">
                {t('delivery.settings.logoConfigured')}: {settings.logo_blob_id}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="receipt-footer" className="text-xs font-medium">
              {t('delivery.settings.footer')}
            </label>
            <Input
              id="receipt-footer"
              className="mt-1.5"
              value={settings.footer_text ?? ''}
              onChange={(event) =>
                setSettings({ ...settings, footer_text: event.target.value || null })
              }
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium">{t('delivery.settings.defaultGates')}</p>
            <p className="mt-1 text-[11px] leading-5 text-foreground/60">
              {t('delivery.settings.defaultGatesDescription')}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {(['software_release', 'artifact_delivery'] as SettingsDeliveryType[]).map(
                (deliveryType) => (
                  <div
                    key={deliveryType}
                    className="rounded-md border border-[hsl(var(--border))] p-3"
                  >
                    <p className="text-xs font-semibold">{t(`delivery.type.${deliveryType}`)}</p>
                    <div className="mt-2 space-y-2">
                      {settingsGateTemplates(settings)[deliveryType].map((gate) => {
                        const defaultLabelKey =
                          gate.gate_key === 'review' && gate.label === 'Review'
                            ? 'review'
                            : gate.gate_key === 'qa' && gate.label === 'QA'
                              ? 'qa'
                              : gate.gate_key === 'data' && gate.label === 'Data'
                                ? 'data'
                                : null;
                        return (
                          <label key={gate.gate_key} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={gate.required}
                              onChange={(event) =>
                                setDefaultGateRequired(
                                  deliveryType,
                                  gate.gate_key,
                                  event.target.checked,
                                )
                              }
                            />
                            {defaultLabelKey
                              ? t(`delivery.gates.defaultLabel.${defaultLabelKey}`)
                              : gate.label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? t('delivery.settings.saving') : t('delivery.settings.save')}
            </Button>
          </div>
        </div>
      )}
    </form>
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
        localizeApiError(
          err,
          t,
          'projectDetail.danger.archivedServicesLoadError',
          'projectDetail.danger.codes',
        ),
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
      setActionError(
        localizeApiError(
          err,
          t,
          'projectDetail.serviceRestore.error',
          'projectDetail.serviceRestore.codes',
        ),
      );
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
      setActionError(
        localizeApiError(
          err,
          t,
          'projectDetail.serviceDelete.error',
          'projectDetail.serviceDelete.codes',
        ),
      );
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
                        {archivedServiceStatusLabel(service.status, t)}
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
      setError(localizeApiError(err, t, 'settings.data.loadFailed', 'settings.data.codes'));
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
      setError(localizeApiError(err, t, 'settings.data.saveFailed', 'settings.data.codes'));
    } finally {
      setActionKey(null);
    }
  };

  const readableScopeLabel = (source: DataSourceSummary) => {
    if (source.kind === 'postgres') return t('settings.data.readableScope.postgres');
    if (source.kind === 'redis') return t('settings.data.readableScope.redis');
    return t('settings.data.readableScope.default');
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
                        {dataSourceKindLabel(source.kind, t)}
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
                            <p className="mt-1 text-foreground/55">{readableScopeLabel(source)}</p>
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
                        {!enabled && (
                          <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-warning">
                            {t('settings.data.enableDecisionHint')}
                          </p>
                        )}
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
      setError(localizeApiError(err, t, 'settings.general.saveFailed', 'settings.general.codes'));
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
