/**
 * Home — v4 hero layout (Phase C rewrite).
 *
 * Three sections per v4 home.jsx:
 *   1. Hero status — one-sentence health rollup + last-deploy row
 *   2. Projects grid — project cards with service-dot list
 *   3. Recent activity peek — top 5 events
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { cn } from '@/lib/utils';

export function Home() {
  const navigate = useNavigate();
  const { projects, loading } = useProjectsContext();

  // Flat health tally across all projects
  const tally = useMemo(() => {
    let healthy = 0;
    let crashed = 0;
    for (const p of projects) {
      if (p.status === 'error') crashed += 1;
      else healthy += 1;
    }
    return { healthy, crashed, total: projects.length };
  }, [projects]);

  const allHealthy = tally.crashed === 0;

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
            System status · just now
          </div>

          {/* Headline */}
          <h1 className="text-[15px] font-medium leading-snug text-[color:var(--ol-fg)]">
            {tally.total === 0 ? (
              <>No projects yet. Create your first project to get started.</>
            ) : allHealthy ? (
              <>
                All <b className="font-semibold">{tally.total}</b> service
                {tally.total === 1 ? '' : 's'} running across{' '}
                <b className="font-semibold">{projects.length}</b> project
                {projects.length === 1 ? '' : 's'}.
              </>
            ) : (
              <>
                <b className="font-semibold text-[color:var(--ol-error)]">{tally.crashed}</b> of{' '}
                {tally.total} service{tally.total === 1 ? '' : 's'} crashed
                <span className="text-[color:var(--ol-fg-muted)]">
                  {' '}
                  · {tally.healthy} running across {projects.length} project
                  {projects.length === 1 ? '' : 's'}.
                </span>
              </>
            )}
          </h1>
        </div>
      </OuterCard>

      {/* ── 2. Projects grid ── */}
      <OuterCard
        title="Projects"
        subtitle={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            View all
            <ChevronRight className="h-3 w-3" />
          </button>
        }
      >
        {projects.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            No projects yet.{' '}
            <button
              type="button"
              onClick={() => navigate('/projects/new')}
              className="text-[color:var(--ol-primary)] underline underline-offset-2"
            >
              Create one
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((p) => {
              const state = p.status === 'error' ? 'crashed' : 'healthy';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => navigate(`/projects/${p.id}`)}
                  aria-label={`Open ${p.name} project`}
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
                          crashed
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
                      {p.serviceCount != null
                        ? `${p.serviceCount} service${p.serviceCount === 1 ? '' : 's'}`
                        : ''}
                    </div>
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
        title="Recent activity"
        subtitle="Audit log of deploys, config changes, and agent calls."
        actions={
          <button
            type="button"
            onClick={() => navigate('/activity')}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)]"
          >
            View all
            <ChevronRight className="h-3 w-3" />
          </button>
        }
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={[]}
          emptyState="No activity yet. Triggers, deploys, agent runs, and incidents will appear here as they happen."
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>
    </div>
  );
}

export default Home;
