/**
 * Deployments — cross-project deploy history (audit view).
 *
 * v4 spec (`/tmp/ol-design-v4-backup/test/project/src/app.jsx:297-310`):
 *   <OuterCard icon="Rocket" title="Deployments"
 *              subtitle="Cross-project deploy history (audit view)">
 *     <DeployRow ... /> ×N
 *   </OuterCard>
 *
 * Filter pills (status + project) live above the row list — same shape
 * the v4 prototype's tabular surfaces use. Click a row to open its log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { DeployRow } from '@/components/Shell/DeployRow';
import { Skeleton } from '@/components/ui/skeleton';
import { listProjects, getProjectDeployments } from '@/lib/api/projects';
import { parseTimestamp } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { DeployLogSummary, Project } from '@/types/index';

interface DeploymentRow extends DeployLogSummary {
  projectName: string;
  projectId: string;
}

type StatusFilter = 'all' | 'success' | 'failed' | 'running';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Done' },
  { id: 'failed', label: 'Failed' },
  { id: 'running', label: 'Running' },
];

export function DeploymentsList() {
  const navigate = useNavigate();
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const projs = await listProjects();
      setProjects(projs);
      const rows: DeploymentRow[] = [];
      await Promise.all(
        projs.map(async (p: Project) => {
          try {
            const deps = await getProjectDeployments(p.id, 20);
            for (const d of deps) {
              rows.push({ ...d, projectName: p.name, projectId: p.id });
            }
          } catch {
            // skip project on fetch error
          }
        }),
      );
      rows.sort((a, b) => {
        const ta = parseTimestamp(a.createdAt)?.getTime() ?? 0;
        const tb = parseTimestamp(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      setDeployments(rows);
    } catch {
      setDeployments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const filtered = useMemo(
    () =>
      deployments.filter((d) => {
        if (statusFilter !== 'all' && d.status !== statusFilter) return false;
        if (projectFilter !== 'all' && d.projectId !== projectFilter) return false;
        return true;
      }),
    [deployments, statusFilter, projectFilter],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            Deployments
          </span>
        }
        subtitle="Cross-project deploy history (audit view)."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-0.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={cn(
                    'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    statusFilter === f.id
                      ? 'bg-[color:var(--ol-panel)] text-[color:var(--ol-fg)] shadow-sm'
                      : 'text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {projects.length > 1 && (
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2 py-1 text-[11px] text-[color:var(--ol-fg)] focus:border-[color:var(--ol-primary)] focus:outline-none"
              >
                <option value="all">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="divide-y divide-[color:var(--ol-border-subtle)]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="h-2 w-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <Rocket className="h-8 w-8 text-[color:var(--ol-fg-subtle)] opacity-60" />
            <p className="text-[13px] font-medium text-[color:var(--ol-fg)]">
              {deployments.length === 0 ? 'No deployments yet' : 'No deployments match the filter'}
            </p>
            <p className="text-[11.5px] text-[color:var(--ol-fg-muted)]">
              {deployments.length === 0
                ? 'Deploy a project to start your build history.'
                : 'Adjust the filters above.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[color:var(--ol-border-subtle)]">
            {filtered.map((d) => (
              <DeployRow
                key={`${d.projectId}-${d.id}`}
                d={d}
                projectName={d.projectName}
                onView={() => navigate(`/projects/${d.projectId}/deployments/${d.id}`)}
              />
            ))}
          </div>
        )}
      </OuterCard>
    </div>
  );
}

export default DeploymentsList;
