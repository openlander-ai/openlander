/**
 * Activity — full timeline page.
 *
 * The same event stream as Home, plus:
 *   - Actor + Project filter pills
 *   - Time-bucket headers (Just now / Earlier today / Yesterday)
 *   - Empty-state copy when filters yield zero matches
 *
 * The row primitive is shared with Home (and MCP Server).
 */
import { useNavigate } from 'react-router-dom';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { useProjectsContext } from '@/hooks/use-projects-context';
import type { ProjectSummary } from '@/lib/agentActivity';

export function Activity() {
  const navigate = useNavigate();
  const { projects } = useProjectsContext();

  // Build project summary list from real project data for filter pills
  const projectSummaries: ProjectSummary[] = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title="Activity"
        subtitle="Audit log — deploys, config changes, service crashes, MCP connections."
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={[]}
          showFilters
          projects={projectSummaries}
          bucketed
          emptyState="No activity yet. Triggers, deploys, agent runs, and incidents will appear here as they happen."
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>
    </div>
  );
}

export default Activity;
