/**
 * Home — v4 hero layout (Phase C rewrite).
 *
 * Three sections per v4 home.jsx:
 *   1. Hero status — one-sentence health rollup + last-deploy row
 *   2. Projects grid — project cards with service-dot list
 *   3. Recent activity peek — top 5 events
 *
 * 1.0-rc.2 (data-model fullsplit): the "Projects" cards on this page now
 * conceptually render groups, with each card showing aggregate service
 * count + a per-service health dot row populated by `useProjectTopology`.
 * Status rollup keeps reading the legacy `status` field, which P1's
 * additive schema still populates on group rows during transition.
 */
import { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { StatusPill, TriggerChip } from '@/components/Shell/DeployRow';
import { AgentGuideDialog } from '@/components/agent-guide';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { useProjectTopology } from '@/hooks/use-project-topology';
import { useLanguage } from '@/i18n/context';
import { getRecentDeployments } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { DeployLogSummary } from '@/types';

// ---- ServiceDots ----
// Separate component so useProjectTopology can be called per-project
// without violating the rules-of-hooks (no hook calls inside .map()).

const SERVICE_DOT_CAP = 8;

interface ServiceDotsProps {
  projectId: string;
  onDotClick: (projectId: string, serviceId: string, e: React.MouseEvent) => void;
}

function ServiceDots({ projectId, onDotClick }: ServiceDotsProps) {
  const { services, isLoading } = useProjectTopology(projectId);

  if (isLoading || services.length === 0) return null;

  const visible = services.slice(0, SERVICE_DOT_CAP);
  const overflow = services.length - visible.length;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {visible.map((svc) => (
        <button
          key={svc.id}
          type="button"
          title={`${svc.name} · ${svc.health}`}
          onClick={(e) => onDotClick(projectId, svc.id, e)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none transition-colors',
            'border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
            'hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              svc.health === 'healthy'
                ? 'bg-[color:var(--ol-success)]'
                : svc.health === 'crashed'
                  ? 'bg-[color:var(--ol-error)]'
                  : 'bg-[color:var(--ol-fg-subtle)]',
            )}
          />
          <span className="max-w-[140px] truncate">{svc.name}</span>
        </button>
      ))}
      {overflow > 0 && (
        // v5 spec: overflow renders as an inline pill chip matching the
        // service-dot style (not bare text), so the row reads as one
        // continuous chip group instead of "chips … plus N".
        <span className="inline-flex shrink-0 items-center rounded-full border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-2 py-0.5 font-mono text-[11px] leading-none text-[color:var(--ol-fg-muted)]">
          +{overflow}
        </span>
      )}
    </div>
  );
}

interface LastDeployState {
  deploy: DeployLogSummary;
  projectId: string;
  projectName: string;
}

export function Home() {
  const navigate = useNavigate();
  const { projects, loading } = useProjectsContext();
  const { events: activityEvents } = useActivityFeed({ limit: 5 });
  const { t } = useLanguage();
  // Two-form plural helper: en grammar needs '1 service' vs '5 services'
  // and our t() has no plural rules. ko renders identically for both forms.
  const pluralCount = (noun: 'deployableServices' | 'projects', count: number): string =>
    t(`common.count.${noun}_${count === 1 ? 'one' : 'other'}`, { count });

  // Flat health tally across all projects
  const tally = useMemo(() => {
    let healthy = 0;
    let crashed = 0;
    for (const p of projects) {
      // p is the frontend Project type (lib/api wire shape) — `status` is a
      // wire-format field, hydrated from services.* server-side post-0012.
      // eslint-disable-next-line openlander-internal/no-dropped-columns
      if (p.status === 'error') crashed += 1;
      else healthy += 1;
    }
    return { healthy, crashed, total: projects.length };
  }, [projects]);

  const allHealthy = tally.crashed === 0;

  const totalDeployableServices = useMemo(
    () => projects.reduce((sum, p) => sum + (p.deployableServiceCount ?? 0), 0),
    [projects],
  );

  const [guideOpen, setGuideOpen] = useState(false);

  // Fetch the most recent deploy across all projects via the
  // aggregate endpoint. The earlier implementation looped Promise.all
  // over `projects` and N+1'd `/api/projects/:id/deployments?limit=1`,
  // which dominated cold-load time on multi-project workspaces.
  const [lastDeployState, setLastDeployState] = useState<LastDeployState | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const recent = await getRecentDeployments(1);
        if (cancelled) return;
        const newest = recent[0];
        if (!newest) return;
        setLastDeployState({
          deploy: newest,
          projectId: newest.projectId,
          projectName: newest.projectName,
        });
      } catch {
        // silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && projects.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <div className="h-[72px] animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
        <div className="h-48 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* ── 1. Hero status ── */}
      <OuterCard divider={false}>
        <div className="flex flex-col gap-3">
          {/* Eyebrow */}
          <div className="flex items-center gap-2 text-[12px] text-[color:var(--ol-fg-muted)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: allHealthy ? 'var(--ol-success)' : 'var(--ol-error)',
                boxShadow: allHealthy
                  ? '0 0 0 3px color-mix(in oklch, var(--ol-success) 25%, transparent)'
                  : '0 0 0 3px color-mix(in oklch, var(--ol-error) 25%, transparent)',
              }}
            />
            {t('home.hero.statusJustNow')}
          </div>

          {/* Headline */}
          <h1 className="text-[15px] font-medium leading-snug text-[color:var(--ol-fg)]">
            {tally.total === 0
              ? t('home.hero.noProjects')
              : allHealthy
                ? t('home.hero.allHealthy', {
                    services: pluralCount('deployableServices', totalDeployableServices),
                    projects: pluralCount('projects', projects.length),
                  })
                : t('home.hero.someCrashed', {
                    crashed: tally.crashed,
                    total: tally.total,
                    healthy: tally.healthy,
                    services: pluralCount('deployableServices', totalDeployableServices),
                  })}
          </h1>
        </div>
      </OuterCard>

      {/* ── 1b. Last-deploy hero card ── */}
      {lastDeployState &&
        (() => {
          const { deploy, projectId, projectName } = lastDeployState;
          const dotColor =
            deploy.status === 'success'
              ? 'var(--ol-success)'
              : deploy.status === 'failed'
                ? 'var(--ol-error)'
                : deploy.status === 'building'
                  ? 'var(--ol-info)'
                  : 'var(--ol-fg-subtle)';
          const shortSha = deploy.commitSha ? deploy.commitSha.slice(0, 7) : deploy.id.slice(0, 8);
          const commitMsg = deploy.commitMessage
            ? deploy.commitMessage.length > 80
              ? deploy.commitMessage.slice(0, 80) + '…'
              : deploy.commitMessage
            : null;
          const timeAgo = formatRelativeTime(deploy.createdAt, t);
          return (
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/deployments/${deploy.id}`)}
              className={cn(
                'group flex w-full cursor-pointer flex-col gap-2 rounded-[var(--ol-radius)] px-4 py-3 text-left',
                'border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)]',
                'shadow-[0_1px_0_color-mix(in_oklch,var(--ol-border-subtle)_70%,transparent)]',
                'transition-colors hover:border-[color:var(--ol-border-strong)] hover:bg-[color:var(--ol-panel-2)]',
              )}
            >
              {/* Eyebrow + status badge */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor: dotColor,
                      boxShadow: `0 0 0 3px color-mix(in oklch, ${dotColor} 25%, transparent)`,
                    }}
                  />
                  {t('home.hero.lastDeploy')}
                </div>
                <StatusPill status={deploy.status} />
              </div>

              {/* Primary — commit message (falls back to project name when no commit msg) */}
              <div className="text-[14px] font-medium leading-snug text-[color:var(--ol-fg)]">
                {commitMsg ?? projectName}
              </div>

              {/* Secondary metadata — wraps on narrow widths */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[color:var(--ol-fg-muted)]">
                {commitMsg && (
                  <>
                    <span>{projectName}</span>
                    <span aria-hidden className="text-[color:var(--ol-fg-subtle)]">
                      ·
                    </span>
                  </>
                )}
                <span className="ol-mono">{shortSha}</span>
                <span aria-hidden className="text-[color:var(--ol-fg-subtle)]">
                  ·
                </span>
                <TriggerChip trigger={deploy.trigger} />
                <span aria-hidden className="text-[color:var(--ol-fg-subtle)]">
                  ·
                </span>
                <span>{timeAgo}</span>
              </div>
            </button>
          );
        })()}

      {/* ── 2. Projects grid ── */}
      <OuterCard
        title={t('home.projects.sectionTitle')}
        subtitle={`${pluralCount('projects', projects.length)} · ${pluralCount('deployableServices', totalDeployableServices)}`}
        actions={
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            {t('common.viewAll')}
            <ChevronRight className="h-3 w-3" />
          </button>
        }
      >
        {projects.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            {t('home.projects.emptyText')}{' '}
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="text-[color:var(--ol-primary)] underline underline-offset-2"
            >
              {t('home.projects.createOne')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((p) => {
              // eslint-disable-next-line openlander-internal/no-dropped-columns
              const state = p.status === 'error' ? 'crashed' : 'healthy';
              const deployableServiceCount = p.deployableServiceCount ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/projects/${p.id}`)}
                  aria-label={t('home.projects.openProject', { name: p.name })}
                  className={cn(
                    'group flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                    state === 'crashed'
                      ? 'border-[color:var(--ol-error)] border-opacity-40 hover:border-[color:var(--ol-error)]'
                      : 'border-[color:var(--ol-border-subtle)] hover:border-[color:var(--ol-border)]',
                    'bg-[color:var(--ol-panel-2)] hover:bg-[color:var(--ol-panel)]',
                  )}
                >
                  {/* Initials glyph */}
                  <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[color:var(--ol-border)] text-[11px] font-semibold text-[color:var(--ol-fg-muted)]"
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[color:var(--ol-fg)]">
                        {p.name}
                      </span>
                      {state === 'crashed' && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[color-mix(in_oklch,var(--ol-error)_12%,transparent)] text-[color:var(--ol-error)]">
                          {t('home.projects.crashedPill')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
                      {pluralCount('deployableServices', deployableServiceCount)}
                    </div>
                    {/* Service dots — one per service, color-coded by health */}
                    <ServiceDots
                      projectId={p.id}
                      onDotClick={(projectId, serviceId, e) => {
                        e.stopPropagation();
                        navigate(`/services/${serviceId}?project=${projectId}`);
                      }}
                    />
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" />
                </button>
              );
            })}
          </div>
        )}
      </OuterCard>

      {/* ── 3. Activity peek ── */}
      <OuterCard
        title={t('home.recentActivity.sectionTitle')}
        subtitle={t('home.recentActivity.sectionSubtitle')}
        actions={
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            {t('common.viewAll')}
            <ChevronRight className="h-3 w-3" />
          </button>
        }
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={activityEvents}
          // Pass the project list down so the row resolves IDs to display
          // names — Home shares the same name resolver as the full Activity
          // page even though it doesn't render the tab strip.
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          emptyState={t('activity.page.emptyState')}
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
          onOpenDeployment={(deploymentId, projectId) =>
            navigate(`/projects/${projectId}/deployments/${deploymentId}`)
          }
        />
      </OuterCard>

      <AgentGuideDialog open={guideOpen} onOpenChange={setGuideOpen} kind="add-service" />
    </div>
  );
}

export default Home;
