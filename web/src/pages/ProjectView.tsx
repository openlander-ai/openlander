/**
 * ProjectViewV2 — Round 4 PR2.
 *
 * The new project page. InfraMap topology strip above an OuterCard.
 * Tabs:
 *   - Services  → flat list of services with health pill + image + url
 *   - Activity  → ActivityTimeline scoped to events for THIS project
 *
 * "Add service" is intentionally demoted to a kebab menu inside Services
 * (matches the agent-first reframe — humans don't normally create
 * services; the agent does it via MCP). Per the strategy notes:
 * "Demote +New Service wizard energy."
 */
import { useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity as ActivityIcon,
  Box,
  Database,
  ExternalLink,
  Plus,
  Settings as SettingsIcon,
} from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { InfraMap } from '@/components/Shell/InfraMap';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { SettingsTab } from '@/components/project/SettingsTab';
import { type ServiceNode } from '@/lib/projectTopology';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useIsBelowMd } from '@/hooks/use-viewport';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { cn } from '@/lib/utils';

type ProjectTabId = 'services' | 'activity' | 'settings';

export function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Honor `?tab=services|activity` deep-links (used by CommandPalette and
  // potentially by external bookmarks). Default = services.
  const tabParam = searchParams.get('tab');
  const initialTab: ProjectTabId =
    tabParam === 'activity' || tabParam === 'settings' ? tabParam : 'services';
  const [activeTab, setActiveTab] = useState<ProjectTabId>(initialTab);

  const projectId = id ?? '';
  const { projects, loading: projectsLoading } = useProjectsContext();
  const realProject = projects.find((p) => p.id === projectId) ?? null;
  const { services, isMockFallback } = useProjectTopology(projectId || null);
  const isBelowMd = useIsBelowMd();

  // Derive display-only fields from real project data
  const projectInitials = realProject
    ? realProject.name
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
    { id: 'services', label: 'Services', icon: Box, count: services.length },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
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
            <span>{realProject?.name ?? projectId}</span>
          </span>
        }
        subtitle={realProject?.repoUrl ?? undefined}
        actions={
          <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
            updated {projectUpdatedAt} · created {projectCreatedAt}
          </span>
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
          <ServicesPanel services={services} onOpen={openService} />
        </TabPanel>
        <TabPanel
          active={activeTab === 'activity'}
          panelId="projectpanel-activity"
          labelledBy="project-activity"
          className="p-0"
        >
          <ActivityTimeline
            events={[]}
            emptyState={
              <span>
                No activity for <b>{realProject?.name ?? projectId}</b> yet. When you (or an agent)
                deploys, restarts, or changes anything in this project, it will appear here.
              </span>
            }
            onOpenService={(_p, sid) => openService(sid)}
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
              projectStatus={realProject?.status}
              isCompose={false}
            />
          )}
        </TabPanel>
      </OuterCard>
    </div>
  );
}

// ─── Services panel ─────────────────────────────────────────────────────────

function ServicesPanel({
  services,
  onOpen,
}: {
  services: ServiceNode[];
  onOpen: (id: string) => void;
}) {
  if (services.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 px-5 py-8">
        <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
          No services in this project yet.
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add service
        </button>
      </div>
    );
  }
  return (
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
                  {s.image}
                  {s.port != null && <span> · :{s.port}</span>}
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
