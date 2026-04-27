/**
 * LogsPage — placeholder for the global logs view.
 *
 * Will show a cross-project recent-deploy-logs feed using
 * /api/deployments/:id/log/stream (SSE). Full log aggregation
 * lands in a follow-up sprint.
 */
import { ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OuterCard } from '@/components/Shell/OuterCard';
import { useProjectsContext } from '@/hooks/use-projects-context';

export function LogsPage() {
  const navigate = useNavigate();
  const { projects, loading } = useProjectsContext();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[color:var(--ol-primary)]" />
            Logs
          </span>
        }
        subtitle="Recent deploy and runtime logs across all projects."
      >
        {loading ? (
          <div className="h-24 animate-pulse rounded-[var(--ol-radius)] bg-[color:var(--ol-panel-2)]" />
        ) : projects.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
            No projects yet. Deploy a project to see logs here.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[color:var(--ol-fg-muted)]">
              Per-service runtime and deploy logs are available inside each service.
            </p>
            <ul className="flex flex-col gap-1.5">
              {projects.slice(0, 8).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)] w-full text-left"
                  >
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] font-semibold text-[color:var(--ol-fg-muted)] bg-[color:var(--ol-border)]"
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </OuterCard>
    </div>
  );
}

export default LogsPage;
