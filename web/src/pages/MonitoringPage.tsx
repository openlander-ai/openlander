/**
 * MonitoringPage — v4 service-aggregate dashboard
 * (ralplan-monitoring-logs Phase 2).
 *
 * Cross-service triage view answering "which service is degrading right
 * now?" — one row per service with name + project badge + health pill +
 * 60-min CPU sparkline + 60-min memory sparkline + last-sample
 * timestamp. Click row → service detail Monitoring tab.
 *
 * Data comes from /api/monitoring/services (server-side fan-out, 15 s
 * polling). Per Principle 1 (no synthetic empty-state numbers): services
 * without ANY metric samples are excluded from the grid and surfaced as
 * a footer ("N services not yet sampling — deploy to populate").
 *
 * Host-level system metrics (CPU/Mem/Disk for the machine itself) are
 * NOT shown — agent-first principle: the agent already has `docker stats`
 * via MCP. Adding a duplicate human dashboard would be slop.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { Sparkline } from '@/components/Shell/Sparkline';
import { useMonitoring, type MonitoringServiceView } from '@/hooks/use-monitoring';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { cn } from '@/lib/utils';

function relativeAge(ms: number | null): string {
  if (ms == null) return 'never';
  const diff = Date.now() - ms;
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${String(sec)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  return `${String(Math.floor(hr / 24))}d ago`;
}

function HealthPill({
  health,
  stale,
}: {
  health: MonitoringServiceView['health'];
  stale: boolean;
}) {
  const cfg =
    health === 'healthy'
      ? { color: 'var(--ol-success)', label: stale ? 'Healthy · stale' : 'Healthy' }
      : health === 'unhealthy'
        ? { color: 'var(--ol-error)', label: stale ? 'Unhealthy · stale' : 'Unhealthy' }
        : { color: 'var(--ol-fg-muted)', label: 'Unknown' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={{
        color: cfg.color,
        backgroundColor: `color-mix(in oklch, ${cfg.color} 12%, transparent)`,
      }}
    >
      <span aria-hidden className="h-1 w-1 rounded-full" style={{ backgroundColor: cfg.color }} />
      {cfg.label}
    </span>
  );
}

interface ServiceRowProps {
  entry: MonitoringServiceView;
  onClick: () => void;
}

function ServiceRow({ entry, onClick }: ServiceRowProps) {
  const cpuLatest = entry.cpu60[entry.cpu60.length - 1] ?? null;
  const memLatest = entry.mem60[entry.mem60.length - 1] ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-4 py-3 text-left transition-colors hover:border-[color:var(--ol-border)] hover:bg-[color:var(--ol-panel)]"
    >
      <div className="min-w-0 flex-[2]">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-[color:var(--ol-fg)]">
            {entry.name}
          </span>
          <HealthPill health={entry.health} stale={entry.stale} />
        </div>
        <div className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
          {entry.projectName ?? 'Unattached'} · {relativeAge(entry.lastSampleAt)}
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
          CPU{cpuLatest != null ? ` · ${cpuLatest.toFixed(1)}%` : ''}
        </div>
        <div className="h-7">
          <Sparkline data={entry.cpu60} color="var(--ol-primary)" />
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
          MEM{memLatest != null ? ` · ${memLatest.toFixed(0)}MB` : ''}
        </div>
        <div className="h-7">
          <Sparkline data={entry.mem60} color="var(--ol-warning)" />
        </div>
      </div>
    </button>
  );
}

export function MonitoringPage() {
  const navigate = useNavigate();
  const { projects } = useProjectsContext();
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const { snapshot, loading } = useMonitoring({ project: projectFilter });

  const projectOptions = useMemo(
    () => [
      { id: 'all', name: 'All projects' },
      ...projects.map((p) => ({ id: p.id, name: p.name })),
    ],
    [projects],
  );

  const handleRowClick = (entry: MonitoringServiceView) => {
    // ServiceDetailV2 reads the project id from `?project=` query param
    // (App.tsx route is `/services/:id`, not nested). The earlier nested
    // path was fictitious — Codex blocker #1.
    if (entry.projectId) {
      navigate(`/services/${entry.serviceId}?project=${entry.projectId}&tab=monitoring`);
    } else {
      navigate(`/services/${entry.serviceId}`);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[color:var(--ol-primary)]" />
            Monitoring
          </span>
        }
        subtitle="Cross-service CPU and memory at a glance. Click a row to drill into per-service charts."
        actions={
          <label className="flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-2 py-1 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="bg-transparent text-[12px] focus:outline-none"
            >
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-3 w-3" />
          </label>
        }
      >
        {loading && !snapshot ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn('h-16 animate-pulse rounded-md bg-[color:var(--ol-panel-2)]')}
              />
            ))}
          </div>
        ) : !snapshot || snapshot.total === 0 ? (
          <div className="py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            No services yet. Deploy a project to see metrics here.
          </div>
        ) : snapshot.services.length === 0 ? (
          <div className="flex flex-col gap-1 py-10 text-center">
            <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
              No services have samples yet.
            </p>
            <p className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
              Showing 0 of {snapshot.total} services — {snapshot.excluded} without samples.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {snapshot.services.map((entry) => (
              <ServiceRow
                key={entry.serviceId}
                entry={entry}
                onClick={() => handleRowClick(entry)}
              />
            ))}
            {snapshot.excluded > 0 && (
              <p className="pt-2 text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                Showing {snapshot.services.length} of {snapshot.total} services —{' '}
                {snapshot.excluded} without samples.
              </p>
            )}
          </div>
        )}
      </OuterCard>
    </div>
  );
}

export default MonitoringPage;
