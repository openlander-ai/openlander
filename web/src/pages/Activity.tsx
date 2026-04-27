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
import { MOCK_ACTIVITY, MOCK_PROJECTS } from '@/lib/agentActivity';

export function Activity() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <OuterCard
        title="Activity"
        subtitle="Audit log — deploys, config changes, service crashes, MCP connections."
        bodyClassName="p-0"
      >
        <ActivityTimeline
          events={MOCK_ACTIVITY}
          showFilters
          projects={MOCK_PROJECTS}
          bucketed
          emptyState="No activity matches these filters."
          onOpenService={(project, service) => navigate(`/services/${service}?project=${project}`)}
        />
      </OuterCard>
    </div>
  );
}

export default Activity;
