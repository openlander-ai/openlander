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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Database, ExternalLink, Plus, Settings as SettingsIcon } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { InfraMap } from '@/components/Shell/InfraMap';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { SettingsTab } from '@/components/project/SettingsTab';
import { AddServiceDialog } from '@/components/project/AddServiceDialog';
import { type ServiceNode } from '@/lib/projectTopology';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useIsBelowMd } from '@/hooks/use-viewport';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

type ProjectTabId = 'services' | 'settings';

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
  const isBelowMd = useIsBelowMd();
  const [addServiceOpen, setAddServiceOpen] = useState(false);

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
    (serviceId: string) => {
      navigate(`/services/${serviceId}?project=${projectId}`);
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
        <OuterCard title="Project not found" subtitle={`No project with id "${projectId}"`}>
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="text-[13px] text-[color:var(--ol-primary)] hover:underline"
          >
            ← Back to Home
          </button>
        </OuterCard>
      </div>
    );
  }

  const tabs: TabDef<ProjectTabId>[] = [
    { id: 'services', label: t('projectDetail.tabs.services'), icon: Box, count: services.length },
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
        onSelectService={(_p, sid) => openService(sid)}
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
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
              updated {projectUpdatedAt} · created {projectCreatedAt}
            </span>
            <button
              type="button"
              onClick={() => setAddServiceOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:opacity-90"
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
            services={services}
            onOpen={openService}
            onAddService={() => setAddServiceOpen(true)}
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
            void refetchProjects();
          }}
        />
      )}
    </div>
  );
}

// ─── Services panel ─────────────────────────────────────────────────────────

function ServicesPanel({
  services,
  onOpen,
  onAddService,
}: {
  services: ServiceNode[];
  onOpen: (id: string) => void;
  onAddService: () => void;
}) {
  const { t } = useLanguage();

  if (services.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-8">
        <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
          {t('projectDetail.servicesGuide.empty')}
        </p>
        <p className="max-w-2xl text-[12px] text-[color:var(--ol-fg-subtle)]">
          {t('projectDetail.servicesGuide.help')}
        </p>
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
      <div className="border-b border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-5 py-3 text-[12px] text-[color:var(--ol-fg-muted)]">
        {t('projectDetail.servicesGuide.banner')}
      </div>
      <ul className="divide-y divide-[color:var(--ol-border-subtle)]">
        {services.map((s) => {
          const KindIcon = s.kind === 'Database' ? Database : Box;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s.id)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-[color:var(--ol-panel-2)]"
              >
                <span
                  aria-hidden
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-md',
                    s.health === 'crashed'
                      ? 'bg-[color:var(--ol-error-soft)] text-[color:var(--ol-error)]'
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
                    <HealthPill health={s.health} />
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
                  <div className="ol-mono tabular-nums">
                    {s.cpu} · {s.mem}
                  </div>
                  {s.url && (
                    <span
                      className="inline-flex items-center gap-1 text-[color:var(--ol-primary)]"
                      aria-hidden
                    >
                      <ExternalLink className="h-3 w-3" />
                      {s.url.replace(/^https?:\/\//, '')}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HealthPill({ health }: { health: 'healthy' | 'crashed' }) {
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
