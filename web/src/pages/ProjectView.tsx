/**
 * ProjectView — v0.1 IA.
 *
 * The project page. InfraMap topology strip above an OuterCard.
 * Tabs:
 *   - Services  → flat list of services with health pill + image + url
 *   - Settings  → group metadata and danger actions
 *
 * MCP tab was removed for v0.1 (project-scoped MCP tokens deferred to v0.2).
 * Activity is no longer a project tab — the
 * global Activity sidebar entry filters by project instead.
 *
 * "Add service" opens a native 1-step dialog (git / image / template)
 * that wires straight to /api/services/deploy. AgentGuideDialog handed
 * the user off to an external MCP agent; v0.1 spec puts the dialog
 * inside the product so the human path is self-contained.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Database, ExternalLink, Plus, Settings as SettingsIcon } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { InfraMap } from '@/components/Shell/InfraMap';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { SettingsTab } from '@/components/project/SettingsTab';
import { AddServiceDialog } from '@/components/project/AddServiceDialog';
import { AgentGuideDialog } from '@/components/agent-guide';
import { type ServiceHealth, type ServiceNode } from '@/lib/projectTopology';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useIsBelowMd } from '@/hooks/use-viewport';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { useLanguage } from '@/i18n/context';
import {
  listGroupServices,
  managedServices,
  type GroupService,
  type ProjectManagedService,
} from '@/lib/api/services';
import { cn } from '@/lib/utils';

type ProjectTabId = 'services' | 'settings';

function hasRuntimeMetricValue(value: string): boolean {
  const normalized = value.trim();
  return normalized !== '' && normalized !== '—' && normalized !== '-';
}

function managedStatusToHealth(status: ProjectManagedService['status']): ServiceHealth {
  return status === 'running' ? 'healthy' : 'crashed';
}

function managedServiceToNode(service: ProjectManagedService): ServiceNode {
  return {
    id: service.id,
    name: service.name,
    kind: 'Database',
    // `service` is the connected managed-service API shape, not a DB service row.
    // eslint-disable-next-line openlander-internal/no-dropped-columns
    port: service.port,
    // eslint-disable-next-line openlander-internal/no-dropped-columns
    image: service.type,
    health: managedStatusToHealth(service.status),
    cpu: '—',
    mem: '—',
    url: null,
    dependsOn: [],
    source: 'managed',
  };
}

function groupServiceToNode(service: GroupService): ServiceNode {
  const health: ServiceHealth =
    service.status === 'running'
      ? 'healthy'
      : service.status === 'building'
        ? 'deploying'
        : 'crashed';

  return {
    id: service.id,
    name: service.name,
    kind: 'Application',
    // `service` is the frontend GroupService wire shape, not a DB service row.
    // eslint-disable-next-line openlander-internal/no-dropped-columns
    port: service.port,

    image: service.image ?? service.imageUrl ?? service.kind,
    health,
    cpu: '—',
    mem: '—',
    url: service.url,
    archivedAt: service.archivedAt ?? null,
    dependsOn: [],
    source: service.source,
    repoUrl: service.repoUrl,
    branch: service.branch,
    deployedBranch: service.deployedBranch,
    dockerfilePath: service.dockerfilePath,
    dockerTarget: service.dockerTarget,
    buildContext: service.buildContext,
    buildMethod: service.buildMethod,
    imageUrl: service.imageUrl,
    imageCmd: service.imageCmd,
    containerPort: service.containerPort,
  };
}

function isManagedServiceNode(service: ServiceNode): boolean {
  return service.source === 'managed';
}

function serviceRoleLabel(service: ServiceNode): string {
  if (isManagedServiceNode(service)) {
    // `service` is the frontend ServiceNode display shape, not a DB service row.
    // eslint-disable-next-line openlander-internal/no-dropped-columns
    const normalized = service.image?.toLowerCase() ?? '';
    if (normalized.includes('postgres')) return 'PostgreSQL';
    if (normalized.includes('timescale')) return 'Timescale';
    if (normalized.includes('redis')) return 'Redis';
    if (normalized.includes('minio')) return 'MinIO';
    if (normalized.includes('mysql')) return 'MySQL';
    if (normalized.includes('mongo')) return 'MongoDB';
    return 'Infrastructure';
  }
  return service.kind === 'Database' ? 'Database' : 'Application';
}

function reportManagedServicesLoadFailure(err: unknown): void {
  if (import.meta.env.DEV) {
    console.warn('[ProjectView] Failed to load connected managed services', err);
  }
}

export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  // Honor `?tab=services|settings` deep-links.
  // - Legacy `?tab=activity` redirects to the global Activity page filtered to this project.
  // - Legacy `?tab=mcp` falls through to `services` (MCP tab removed in v0.1; project-scoped
  //   tokens deferred to v0.2).
  const tabParam = searchParams.get('tab');
  const initialTab: ProjectTabId = tabParam === 'settings' ? 'settings' : 'services';
  const [activeTab, setActiveTab] = useState<ProjectTabId>(initialTab);

  const projectId = id ?? '';
  // 1.0-rc.2 (data-model fullsplit): `useProjectsContext()` returns
  // groups (formerly projects). Topology gives the deployable nodes for
  // InfraMap + Services tab — the canonical `/api/projects/:p/services`
  // endpoint (`useGroupServices`) is reserved for callers that need
  // shaped GroupService data instead of the topology ServiceNode shape.
  const { projects, loading: projectsLoading, refetch: refetchProjects } = useProjectsContext();
  const realProject = projects.find((p) => p.id === projectId) ?? null;
  const {
    services,
    isMockFallback,
    refetch: refetchTopology,
  } = useProjectTopology(projectId || null);
  const [managedServiceNodes, setManagedServiceNodes] = useState<ServiceNode[]>([]);
  const [showArchivedServices, setShowArchivedServices] = useState(false);
  const [archivedServiceNodes, setArchivedServiceNodes] = useState<ServiceNode[]>([]);
  const [archivedServicesLoading, setArchivedServicesLoading] = useState(false);
  const [archivedServicesError, setArchivedServicesError] = useState<string | null>(null);
  const isBelowMd = useIsBelowMd();
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  // Managed databases/caches are agent-provisioned, not built here — this
  // secondary action hands the user to the MCP guide instead of a native DB
  // wizard (kind="add-managed-db", never "add-service").
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const refetchManagedServices = useCallback(async () => {
    if (!projectId) {
      setManagedServiceNodes([]);
      return;
    }
    try {
      const rows = await managedServices.listForGroup(projectId);
      setManagedServiceNodes(rows.map(managedServiceToNode));
    } catch (err) {
      reportManagedServicesLoadFailure(err);
      setManagedServiceNodes([]);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      return () => {
        active = false;
      };
    }
    managedServices
      .listForGroup(projectId)
      .then((rows) => {
        if (active) setManagedServiceNodes(rows.map(managedServiceToNode));
      })
      .catch((err) => {
        reportManagedServicesLoadFailure(err);
        if (active) setManagedServiceNodes([]);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    if (!projectId || !showArchivedServices) {
      setArchivedServiceNodes([]);
      setArchivedServicesError(null);
      setArchivedServicesLoading(false);
      return () => {
        active = false;
      };
    }

    setArchivedServicesLoading(true);
    listGroupServices(projectId, { includeArchived: true })
      .then((rows) => {
        if (!active) return;
        setArchivedServiceNodes(rows.map(groupServiceToNode));
        setArchivedServicesError(null);
      })
      .catch((err) => {
        if (!active) return;
        setArchivedServiceNodes([]);
        setArchivedServicesError(
          err instanceof Error ? err.message : 'Failed to load archived services',
        );
      })
      .finally(() => {
        if (active) setArchivedServicesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [projectId, showArchivedServices]);

  const projectServiceRows = useMemo(() => {
    const deployableServices = showArchivedServices ? archivedServiceNodes : services;
    const serviceIds = new Set(deployableServices.map((service) => service.id));
    const connectedManagedServices = managedServiceNodes.filter(
      (service) => !serviceIds.has(service.id),
    );
    return [...deployableServices, ...connectedManagedServices];
  }, [archivedServiceNodes, managedServiceNodes, services, showArchivedServices]);

  useEffect(() => {
    if (tabParam === 'activity' && projectId) {
      navigate(`/activity?project=${encodeURIComponent(projectId)}`, { replace: true });
    }
  }, [navigate, projectId, tabParam]);

  // Derive display-only fields from real project data
  const projectDisplayName = realProject?.displayName ?? realProject?.name ?? projectId;
  const projectInitials = realProject
    ? projectDisplayName
        .split(/[-_\s]/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : projectId.slice(0, 2).toUpperCase();

  // Deterministic hue from project id for consistent color without a backend field
  const hue = [...projectId].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const projectColor = `oklch(0.58 0.17 ${hue})`;

  const projectCreatedAt = realProject
    ? new Date(realProject.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
  const projectUpdatedAt = realProject
    ? new Date(realProject.updatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '—';

  // Single helper so every internal navigation carries the project context.
  // Avoids drift where some callers forget to attach `?project=` and the
  // service detail page falls back to a default.
  const openService = useCallback(
    (service: ServiceNode) => {
      if (isManagedServiceNode(service)) {
        navigate(`/projects/${projectId}/infrastructure/${service.id}`);
        return;
      }
      navigate(`/services/${service.id}?project=${projectId}`);
    },
    [navigate, projectId],
  );

  // While projects are loading show a skeleton so we don't flash "not found"
  if (projectsLoading && !realProject) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="h-32 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
        <div className="h-64 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
      </div>
    );
  }

  if (!projectsLoading && !realProject) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard
          title={t('projectDetail.notFound')}
          subtitle={t('projectDetail.notFoundSubtitle', { id: projectId ?? '' })}
        >
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            {t('projectDetail.backToHome')}
          </button>
        </OuterCard>
      </div>
    );
  }

  const tabs: TabDef<ProjectTabId>[] = [
    {
      id: 'services',
      label: t('projectDetail.tabs.services'),
      icon: Box,
      count: projectServiceRows.length,
    },
    { id: 'settings', label: t('projectDetail.tabs.settings'), icon: SettingsIcon },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* InfraMap strip — sits above the outer card.
          Below the md breakpoint we force the dense (3-lane) layout so the
          nodes stay readable instead of trying to fit a horizontal row on a
          narrow viewport. */}
      <InfraMap
        projectId={projectId}
        services={services}
        agentActivity={[]}
        forceDense={isBelowMd}
        isDemo={isMockFallback}
        onSelectService={(_p, sid) => {
          const selected = services.find((service) => service.id === sid);
          if (selected) openService(selected);
        }}
      />

      {/* Outer card with tabs */}
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid h-6 w-6 place-items-center rounded-md text-[10px] font-semibold text-white"
              style={{ backgroundColor: projectColor }}
            >
              {projectInitials}
            </span>
            <span>{projectDisplayName}</span>
          </span>
        }
        subtitle={
          // Page header spec: "Subtitle / description (muted, 14px) —
          // brief description of the page's purpose."
          //
          // Round-1 CCG: Codex flagged unbounded description risk +
          // Gemini flagged slug-precedence regression. Resolve both:
          //   - line-clamp + break-words on the description so a
          //     pasted paragraph cannot dominate the header.
          //   - keep the slug visible alongside when displayName
          //     diverges, since ops users key off the slug for CLI /
          //     compose paths.
          // Always anchor the subtitle with the "Project group" label so the
          // user keeps the containing-group context even when a custom
          // description is set. PR #59 follow-up: post-onboarding users were
          // losing the group-vs-service distinction once descriptions appeared.
          (() => {
            const description = realProject?.description?.trim();
            const showSlug =
              realProject?.displayName != null && realProject.displayName !== realProject.name;
            return (
              <span className="line-clamp-2 break-words">
                <span className="text-[color:var(--ol-fg-subtle)]">{t('vocab.projectGroup')}</span>
                {description && <span> · {description}</span>}
                {showSlug && (
                  <span className="ml-1.5 text-[color:var(--ol-fg-subtle)]">
                    · {realProject!.name}
                  </span>
                )}
              </span>
            );
          })()
        }
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:gap-3">
            <span className="w-full text-[11px] text-[color:var(--ol-fg-subtle)] sm:w-auto">
              updated {projectUpdatedAt} · created {projectCreatedAt}
            </span>
            <button
              type="button"
              onClick={() => setAgentGuideOpen(true)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
            >
              <Database className="h-3.5 w-3.5" />
              Ask Agent
            </button>
            <button
              type="button"
              onClick={() => setAddServiceOpen(true)}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add service
            </button>
          </div>
        }
        bodyClassName="p-0"
      >
        <ProjectTabs
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
          idPrefix="project"
          ariaLabel="Project sections"
        />
        <TabPanel
          active={activeTab === 'services'}
          panelId="projectpanel-services"
          labelledBy="project-services"
          className="p-0"
        >
          <ServicesPanel
            services={projectServiceRows}
            onOpen={openService}
            onAddService={() => setAddServiceOpen(true)}
            showArchived={showArchivedServices}
            archivedLoading={archivedServicesLoading}
            archivedError={archivedServicesError}
            onShowArchivedChange={setShowArchivedServices}
          />
        </TabPanel>
        <TabPanel
          active={activeTab === 'settings'}
          panelId="projectpanel-settings"
          labelledBy="project-settings"
          className="p-0"
        >
          {projectId && (
            <SettingsTab
              projectId={projectId}
              project={realProject}
              onProjectChanged={() => {
                void refetchProjects();
              }}
              onProjectDeleted={() => {
                void refetchProjects();
                navigate('/projects');
              }}
            />
          )}
        </TabPanel>
      </OuterCard>

      {realProject && (
        <AddServiceDialog
          open={addServiceOpen}
          onOpenChange={setAddServiceOpen}
          projectId={projectId}
          projectName={realProject.name}
          displayName={projectDisplayName}
          onCreated={() => {
            refetchTopology();
            void refetchManagedServices();
            void refetchProjects();
          }}
        />
      )}

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="add-managed-db"
        projectName={realProject?.name}
      />
    </div>
  );
}

// ─── Services panel ─────────────────────────────────────────────────────────

function ServicesPanel({
  services,
  onOpen,
  onAddService,
  showArchived,
  archivedLoading,
  archivedError,
  onShowArchivedChange,
}: {
  services: ServiceNode[];
  onOpen: (service: ServiceNode) => void;
  onAddService: () => void;
  showArchived: boolean;
  archivedLoading: boolean;
  archivedError: string | null;
  onShowArchivedChange: (show: boolean) => void;
}) {
  const { t } = useLanguage();
  const toggleArchived = () => onShowArchivedChange(!showArchived);

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-8">
        <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
          {t('projectDetail.servicesGuide.empty')}
        </p>
        <p className="max-w-2xl text-[12px] text-[color:var(--ol-fg-subtle)]">
          {t('projectDetail.servicesGuide.help')}
        </p>
        {archivedError && (
          <p className="max-w-2xl text-[12px] text-[color:var(--ol-error)]">
            {t('projectDetail.servicesGuide.archivedLoadError', { message: archivedError })}
          </p>
        )}
        <button
          type="button"
          onClick={toggleArchived}
          disabled={archivedLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showArchived
            ? t('projectDetail.servicesGuide.hideArchived')
            : archivedLoading
              ? t('projectDetail.servicesGuide.loadingArchived')
              : t('projectDetail.servicesGuide.showArchived')}
        </button>
        <button
          type="button"
          onClick={onAddService}
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add service
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-5 py-3 text-[12px] text-[color:var(--ol-fg-muted)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span>
            {showArchived
              ? t('projectDetail.servicesGuide.archivedVisible')
              : t('projectDetail.servicesGuide.banner')}
          </span>
          {archivedError && (
            <span className="ml-2 text-[color:var(--ol-error)]">
              {t('projectDetail.servicesGuide.archivedLoadError', { message: archivedError })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleArchived}
          disabled={archivedLoading}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2.5 py-1 text-[11.5px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-pressed={showArchived}
        >
          {showArchived
            ? t('projectDetail.servicesGuide.hideArchived')
            : archivedLoading
              ? t('projectDetail.servicesGuide.loadingArchived')
              : t('projectDetail.servicesGuide.showArchived')}
        </button>
      </div>
      <ul className="divide-y divide-[color:var(--ol-border-subtle)]">
        {services.map((s) => {
          const KindIcon = s.kind === 'Database' ? Database : Box;
          const open = () => onOpen(s);
          return (
            <li key={s.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-[color:var(--ol-panel-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[color:var(--ol-primary)]"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-md',
                    s.health === 'crashed'
                      ? 'bg-[color:var(--ol-error-soft)] text-[color:var(--ol-error)]'
                      : s.health === 'deploying'
                        ? 'bg-[color:var(--ol-info-soft)] text-[color:var(--ol-info)]'
                        : 'bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]',
                  )}
                >
                  <KindIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-[color:var(--ol-fg)]">
                      {s.name}
                    </span>
                    <ServiceRoleBadge service={s} />
                    {s.archivedAt && (
                      <span className="rounded-full border border-[color:var(--ol-border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.serviceLifecycle.archivedBadge')}
                      </span>
                    )}
                    {!s.archivedAt && <HealthPill health={s.health} />}
                  </div>
                  <div className="ol-mono mt-0.5 truncate text-[11.5px] text-[color:var(--ol-fg-muted)]">
                    {/* `s` is the frontend ServiceNode shape (lib/projectTopology), not a DB row;
                        `image` and `port` are wire-format fields, not the dropped service columns. */}
                    {/* eslint-disable-next-line openlander-internal/no-dropped-columns */}
                    {s.image}
                    {/* eslint-disable-next-line openlander-internal/no-dropped-columns */}
                    {s.port != null && <span> · :{s.port}</span>}
                  </div>
                  <div
                    className="ol-mono mt-0.5 truncate text-[11px] text-[color:var(--ol-fg-subtle)]"
                    title={t('projectDetail.servicesGuide.serviceIdTooltip')}
                  >
                    {t('projectDetail.servicesGuide.serviceId', { id: s.id })}
                  </div>
                </div>
                <div className="hidden shrink-0 text-right text-[11.5px] text-[color:var(--ol-fg-muted)] sm:block">
                  {(hasRuntimeMetricValue(s.cpu) || hasRuntimeMetricValue(s.mem)) && (
                    <div className="ol-mono tabular-nums">
                      {[s.cpu, s.mem].filter(hasRuntimeMetricValue).join(' · ')}
                    </div>
                  )}
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[color:var(--ol-primary)] hover:underline"
                      aria-label={`Open ${s.name}`}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {s.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ServiceRoleBadge({ service }: { service: ServiceNode }) {
  const managed = isManagedServiceNode(service);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        managed
          ? 'border-[color:var(--ol-border)] bg-[color:var(--ol-info-soft)] text-[color:var(--ol-info)]'
          : 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
      )}
    >
      {serviceRoleLabel(service)}
    </span>
  );
}

function HealthPill({ health }: { health: ServiceHealth }) {
  if (health === 'crashed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-error-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-error)]">
        <span
          aria-hidden
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: 'var(--ol-error)' }}
        />
        crashed
      </span>
    );
  }
  if (health === 'deploying') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-info-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-info)]">
        <span
          aria-hidden
          className="h-1 w-1 animate-pulse rounded-full"
          style={{ backgroundColor: 'var(--ol-info)' }}
        />
        deploying
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ol-success-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-success)]">
      <span
        aria-hidden
        className="h-1 w-1 rounded-full"
        style={{ backgroundColor: 'var(--ol-success)' }}
      />
      healthy
    </span>
  );
}

export default ProjectView;
