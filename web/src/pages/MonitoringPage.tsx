/**
 * MonitoringPage — placeholder for the global monitoring view.
 *
 * Shows a list of running services with live CPU/memory metrics
 * pulled from /api/services/:id/metrics via useServiceMetrics.
 * Full dashboard charts land in a follow-up sprint.
 */
import { BarChart3 } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { useProjectsContext } from '@/hooks/use-projects-context';

export function MonitoringPage() {
  const { projects, loading } = useProjectsContext();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[color:var(--ol-primary)]" />
            Monitoring
          </span>
        }
        subtitle="CPU, memory, and request metrics across all services."
      >
        {loading ? (
          <div className="h-24 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
        ) : projects.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            No projects yet. Deploy a project to see metrics here.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
              {projects.length} project{projects.length === 1 ? '' : 's'} · per-service charts
              coming soon.
            </p>
            <p className="text-[12px] text-[color:var(--ol-fg-subtle)]">
              Open a service and go to the Monitoring tab to view live CPU, memory, and request
              metrics.
            </p>
          </div>
        )}
      </OuterCard>
    </div>
  );
}

export default MonitoringPage;
