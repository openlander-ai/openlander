import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { IncidentCard, type IncidentGroup } from '@/components/ops/IncidentCard';
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

function extractEventType(incident: OpsIncident): string {
  if (incident.events && incident.events.length > 0) {
    return incident.events[0].type;
  }
  return (incident.title || incident.severity || 'unknown').toLowerCase().replace(/\s+/g, '_');
}

function humanizeEventType(type: string): string {
  return type.replace(/[:_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeDescription(incident: OpsIncident): string {
  if (incident.events && incident.events.length > 0) {
    return incident.events[0].message || incident.title || `${incident.severity} incident`;
  }
  return incident.title || `${incident.severity} incident`;
}

function groupIncidents(
  incidents: OpsIncident[],
  projectNameById: Record<string, string>,
): GroupedIncident[] {
  const grouped = new Map<string, OpsIncident[]>();

  for (const incident of incidents) {
    if (!projectNameById[incident.project_id]) continue; // Skip archived projects
    const typeKey = extractEventType(incident);
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
      return {
        projectId,
        projectName: projectNameById[projectId] ?? projectId.substring(0, 8),
        group: {
          key,
          severity: latest.severity,
          label: humanizeEventType(extractEventType(latest)),
          description: humanizeDescription(latest),
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

  const loadIncidents = useCallback(async () => {
    try {
      const data = await fetchOpsIncidents(projectId);
      const active = (data.incidents ?? []).filter((incident) => incident.status !== 'resolved');
      active.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setIncidents(active);
    } catch (err) {
      console.error('Failed to load incidents', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void loadIncidents();
  }, [loadIncidents, refreshToken]);

  const groupedIncidents = useMemo(
    () => groupIncidents(incidents, projectNameById),
    [incidents, projectNameById],
  );

  return (
    <Card className="border-border bg-panel p-4 lg:p-5">
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
            <div key={group.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-body text-xs text-secondary-ol">
                  {projectName}
                </Badge>
                <Badge variant="secondary" className="font-body text-[11px] capitalize">
                  {t(group.severity)}
                </Badge>
                <span className="font-mono text-[11px] text-muted-ol">{incidentProjectId}</span>
              </div>
              <IncidentCard group={group} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
