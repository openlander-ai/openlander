import { useCallback, useEffect, useMemo, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { IncidentCard, type IncidentGroup } from '@/components/ops/IncidentCard';
import { humanizeDescription, humanizeEventType } from '@/components/ops/utils';
import { type OpsIncident, fetchOpsIncidents } from '@/lib/api/operations';
import { useLanguage } from '@/i18n/context';

interface IncidentMapProps {
  projectId?: string;
  projectNameById: Record<string, string>;
  refreshToken: number;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface GroupedIncident {
  projectId: string;
  projectName: string;
  group: IncidentGroup;
}

function hasSameIncidents(prev: OpsIncident[], next: OpsIncident[]): boolean {
  if (prev.length !== next.length) {
    return false;
  }

  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id ||
      a.status !== b.status ||
      a.severity !== b.severity ||
      a.title !== b.title ||
      a.triggerType !== b.triggerType ||
      a.created_at !== b.created_at
    ) {
      return false;
    }
  }

  return true;
}

function groupIncidents(
  incidents: OpsIncident[],
  projectNameById: Record<string, string>,
  t: (key: string) => string,
): GroupedIncident[] {
  const grouped = new Map<string, OpsIncident[]>();

  for (const incident of incidents) {
    if (!projectNameById[incident.project_id]) continue; // Skip archived projects
    const typeKey =
      incident.triggerType ||
      (incident.title || incident.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
    const key = `${incident.project_id}::${incident.severity}::${typeKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(incident);
  }

  return Array.from(grouped.entries())
    .map(([key, entries]) => {
      const latest = entries[0];
      const projectId = latest.project_id;
      const typeKey =
        latest.triggerType ||
        (latest.title || latest.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
      return {
        projectId,
        projectName: projectNameById[projectId] ?? projectId.substring(0, 8),
        group: {
          key,
          severity: latest.severity,
          label: humanizeEventType(typeKey, t),
          description: humanizeDescription(latest.title || latest.severity, t),
          count: entries.length,
          firstSeen: Math.min(...entries.map((item) => new Date(item.created_at).getTime())),
          lastSeen: Math.max(...entries.map((item) => new Date(item.created_at).getTime())),
          latestIncident: latest,
          status: latest.status,
        },
      } satisfies GroupedIncident;
    })
    .sort((a, b) => {
      const aRank = SEVERITY_RANK[a.group.severity] ?? 99;
      const bRank = SEVERITY_RANK[b.group.severity] ?? 99;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return b.group.lastSeen - a.group.lastSeen;
    });
}

export function IncidentMap({ projectId, projectNameById, refreshToken }: IncidentMapProps) {
  const { t } = useLanguage();
  const [incidents, setIncidents] = useState<OpsIncident[]>([]);
  const [loading, setLoading] = useState(true);

  const loadIncidents = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) {
        setLoading(true);
      }

      try {
        const data = await fetchOpsIncidents(projectId);
        const active = (data.incidents ?? []).filter((incident) => incident.status !== 'resolved');
        active.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setIncidents((prev) => (hasSameIncidents(prev, active) ? prev : active));
      } catch (err) {
        console.error('Failed to load incidents', err);
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadIncidents(true);
  }, [loadIncidents]);

  useEffect(() => {
    if (refreshToken === 0) return;
    void loadIncidents(false);
  }, [loadIncidents, refreshToken]);

  const groupedIncidents = useMemo(
    () => groupIncidents(incidents, projectNameById, t),
    [incidents, projectNameById, t],
  );

  return (
    <Card className="min-w-0 border-border bg-panel p-4 lg:p-5">
      <h2 className="mb-4 font-display text-lg font-semibold text-primary-ol">
        {t('operations.incidents.title')}
      </h2>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : groupedIncidents.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-subtle px-4 py-8 text-center text-sm font-body text-muted-ol">
          {t('operations.incidents.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedIncidents.map(({ group, projectName, projectId: incidentProjectId }) => (
            <div key={group.key}>
              <IncidentCard
                group={group}
                projectName={projectName}
                incidentProjectId={incidentProjectId}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
