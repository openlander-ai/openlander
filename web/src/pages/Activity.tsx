/**
 * Activity — full timeline page.
 *
 * The same event stream as Home, plus:
 *   - Actor + Project filter pills
 *   - Time-bucket headers (Just now / Earlier today / Yesterday)
 *   - Empty-state copy when filters yield zero matches
 *
 * The row primitive is shared with Home (and MCP Server).
 *
 * 1.0-rc.2 (data-model fullsplit): filter pills on this page key on
 * group id (`project_id` field on the event), since group-level activity
 * is the natural roll-up for an audit timeline. Service-level filtering
 * keys on `service_id` and is exposed inside ServiceDetailV2's Activity
 * surface (rc.2 will route service rows accordingly).
 */
import { useNavigate } from 'react-router-dom';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ActivityTimeline } from '@/components/Shell/ActivityTimeline';
import { useActivityFeed } from '@/hooks/use-activity-feed';
import { useProjectsContext } from '@/hooks/use-projects-context';
import type { ProjectSummary } from '@/lib/agentActivity';

export function Activity() {
  const navigate = useNavigate();
  const { projects } = useProjectsContext();
  const { events } = useActivityFeed({ limit: 200 });

  // Build project summary list from real project data for filter pills
  const projectSummaries: ProjectSummary[] = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title="Activity"
        subtitle="Audit log — deploys, config changes, crashes, and MCP connections."
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={events}
          showFilters
          projects={projectSummaries}
          bucketed
          emptyState="No activity yet. Triggers, deploys, agent runs, and incidents will appear here as they happen."
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
          onOpenDeployment={(deploymentId, projectId) =>
            navigate(`/projects/${projectId}/deployments/${deploymentId}`)
          }
        />
      </OuterCard>
    </div>
  );
}

export default Activity;
