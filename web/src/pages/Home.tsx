/**
 * Home — Unified Activity Stream (Round 4 PR1).
 *
 * Per Gemini's "냉혹한 다이어트" verdict + user's "심플하지 않다" feedback,
 * Home drops the 4-card layout. Two elements only:
 *
 *   1. Thin system status bar at the top (one sentence).
 *   2. Big Activity timeline below — agent + human + webhook + system
 *      events as a single Linear-style stream.
 *
 * No PendingDecisions card. No Incidents card. No project grid (sidebar
 * owns that navigation). No agent reasoning paragraphs (the row's
 * one-line `detail` is the whole story).
 *
 * The agent presence reads in 5 seconds: every `mcp`-tagged row carries
 * the Bot icon, and the recent stream skews to MCP-triggered deploys.
 */
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { MOCK_ACTIVITY, MOCK_SYSTEM_STATUS } from '@/lib/agentActivity';
import { useProjectsContext } from '@/hooks/use-projects-context';

export function Home() {
  const navigate = useNavigate();
  // Live project count + status comes from the backend. Service-level
  // health (totalServices / healthyServices / crashedServices) stays
  // mocked until /api/services/:id/health ships — we don't have a
  // cross-project rollup endpoint today.
  const { projects, loading, error } = useProjectsContext();
  const liveTotalProjects =
    !loading && !error && projects.length > 0 ? projects.length : MOCK_SYSTEM_STATUS.totalProjects;
  const liveCrashedProjects = projects.filter((p) => p.status === 'error').length;
  const status = {
    ...MOCK_SYSTEM_STATUS,
    totalProjects: liveTotalProjects,
    // Promote real "project crashed" signal into the trouble counter when
    // we have backend data. Service-level crashes still come from the mock
    // until per-service health is wired up.
    crashedServices:
      !loading && !error
        ? Math.max(MOCK_SYSTEM_STATUS.crashedServices, liveCrashedProjects)
        : MOCK_SYSTEM_STATUS.crashedServices,
  };
  const trouble = status.crashedServices;
  const allHealthy = trouble === 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      {/* ─── 1. Status bar ─── */}
      <div
        className="flex items-center gap-3 rounded-[var(--ol-radius)] border bg-[color:var(--ol-panel)] px-5 py-3.5"
        style={{ borderColor: 'var(--ol-border)' }}
      >
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: allHealthy ? 'var(--ol-success)' : 'var(--ol-error)',
            boxShadow: allHealthy
              ? '0 0 0 4px color-mix(in oklch, var(--ol-success) 25%, transparent)'
              : '0 0 0 4px color-mix(in oklch, var(--ol-error) 25%, transparent)',
          }}
        />
        <h1 className="flex-1 text-[14px] font-medium leading-tight text-[color:var(--ol-fg)]">
          {allHealthy ? (
            <>
              All <b className="font-semibold">{status.totalServices}</b> services running across{' '}
              <b className="font-semibold">{status.totalProjects}</b> projects.
            </>
          ) : (
            <>
              <b className="font-semibold text-[color:var(--ol-error)]">{trouble}</b> of{' '}
              {status.totalServices} services need attention
              <span className="text-[color:var(--ol-fg-muted)]">
                {' '}
                · {status.healthyServices} running across {status.totalProjects} projects
              </span>
            </>
          )}
        </h1>
        <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
          observed {status.observedAt}
        </span>
      </div>

      {/* ─── 2. Unified Activity Stream ─── */}
      <OuterCard
        title="Activity"
        subtitle="Everything that's happening — agents, humans, webhooks, system."
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
          events={MOCK_ACTIVITY}
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>
    </div>
  );
}

export default Home;
