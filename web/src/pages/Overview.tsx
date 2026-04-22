import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, RefreshCw, ShieldCheck, AlertCircle, DollarSign, HeartOff } from 'lucide-react';
import { ProjectCard } from '@/components/dashboard/ProjectCard';
import { Skeleton } from '@/components/ui/skeleton';
import { usePollingTask } from '@/hooks/use-polling-task';
import { useLanguage } from '@/i18n/context';
import { apiGet } from '@/lib/api/client';
import {
  listProjects,
  redeployProject,
  type ProjectWithOptionalEnvironments,
} from '@/lib/api/projects';
import { fetchActivityFeed, type ActivityItem } from '@/lib/api/operations';
import { getStatusConfigMap } from '@/lib/status-config';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';

interface OverviewStats {
  active_deploys: number;
  active_recoveries: number;
  pending_approvals: number;
  open_incidents: number;
  unhealthy_services: number;
  ai_spend_today: number;
}

function getStatusConfig() {
  return getStatusConfigMap({
    running: 'Healthy',
    stopped: 'Stopped',
    building: 'Deploying',
    error: 'Failed',
  });
}

export function Overview() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const statusConfig = getStatusConfig();

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [projects, setProjects] = useState<ProjectWithOptionalEnvironments[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeployingIds, setRedeployingIds] = useState<Set<string>>(new Set());

  usePollingTask(
    async () => {
      try {
        const [statsData, activitiesData] = await Promise.all([
          apiGet<OverviewStats>('/api/overview/stats'),
          fetchActivityFeed({ limit: 10 }),
        ]);
        setStats(statsData);
        setActivities(activitiesData.activities);
      } catch (error) {
        console.error('Failed to fetch overview stats/activities:', error);
      } finally {
        setLoading(false);
      }
    },
    { intervalMs: 10000 },
  );

  usePollingTask(
    async () => {
      try {
        const projectsData = await listProjects(false);
        setProjects(projectsData);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
      }
    },
    { intervalMs: 30000 },
  );

  const handleRedeploy = async (event: MouseEvent, projectId: string) => {
    event.stopPropagation();
    setRedeployingIds((prev) => new Set(prev).add(projectId));
    try {
      await redeployProject(projectId);
      const projectsData = await listProjects(false);
      setProjects(projectsData);
    } catch (error) {
      console.error('Redeploy failed:', error);
    } finally {
      setRedeployingIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  const errorProjects = projects.filter((p) => p.status === 'error');
  const hasNeedsAttention =
    errorProjects.length > 0 ||
    (stats?.pending_approvals ?? 0) > 0 ||
    (stats?.unhealthy_services ?? 0) > 0;

  if (loading) {
    return (
      <div className="flex flex-col h-full w-full">
        <PageHeader title={t('overview.title')} />
        <div className="p-6 xl:p-8 space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader title={t('overview.title')} />
      <div className="p-6 xl:p-8 space-y-8">
        {/* KPI Row — muted icons; attention-requiring KPIs tint the icon when count > 0 */}
        <div data-testid="kpi-row" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            icon={<Rocket className="h-5 w-5" />}
            value={stats?.active_deploys ?? 0}
            label={t('overview.kpi.activeDeploys')}
            onClick={() => navigate('/deployments')}
          />
          <KpiCard
            icon={<RefreshCw className="h-5 w-5" />}
            value={stats?.active_recoveries ?? 0}
            label={t('overview.kpi.recoveries')}
            onClick={() => navigate('/operations')}
          />
          <KpiCard
            icon={<ShieldCheck className="h-5 w-5" />}
            value={stats?.pending_approvals ?? 0}
            label={t('overview.kpi.approvals')}
            attention={(stats?.pending_approvals ?? 0) > 0 ? 'warning' : undefined}
            onClick={() => navigate('/operations?tab=approvals')}
          />
          <KpiCard
            icon={<AlertCircle className="h-5 w-5" />}
            value={stats?.open_incidents ?? 0}
            label={t('overview.kpi.incidents')}
            attention={(stats?.open_incidents ?? 0) > 0 ? 'critical' : undefined}
            onClick={() => navigate('/operations?tab=live')}
          />
          <KpiCard
            icon={<HeartOff className="h-5 w-5" />}
            value={stats?.unhealthy_services ?? 0}
            label={t('overview.kpi.services')}
            attention={(stats?.unhealthy_services ?? 0) > 0 ? 'critical' : undefined}
            onClick={() => navigate('/services')}
          />
          <KpiCard
            icon={<DollarSign className="h-5 w-5" />}
            value={`$${(stats?.ai_spend_today ?? 0).toFixed(2)}`}
            label={t('overview.kpi.aiSpend')}
            onClick={() => navigate('/operations?tab=usage')}
          />
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-[hsl(var(--border))] rounded-lg bg-bg-panel">
            <Rocket className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-foreground/80 max-w-md">{t('overview.empty')}</p>
          </div>
        ) : (
          <>
            {/* Main 2-column layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left: Live Activity */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-display font-semibold text-lg text-foreground">
                  {t('overview.activity.title')}
                </h2>
                <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg overflow-hidden">
                  {activities.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      {t('overview.activity.empty')}
                    </div>
                  ) : (
                    <div className="divide-y divide-[hsl(var(--border))]/50">
                      {activities.map((activity) => (
                        <div
                          key={activity.id}
                          className="p-4 flex items-start gap-4 hover:bg-bg-subtle/50 transition-colors"
                        >
                          <div className="mt-1">
                            <ActivityIcon type={activity.type} severity={activity.severity} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-foreground truncate">
                                {activity.title}
                              </p>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {t('overview.activity.timeAgo').replace(
                                  '{time}',
                                  formatRelativeTime(activity.timestamp, t),
                                )}
                              </span>
                            </div>
                            <p className="text-xs text-foreground/80 mt-1 truncate">
                              <span className="font-medium text-foreground mr-2">
                                {activity.projectName}
                              </span>
                              {activity.description}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Needs Attention */}
              <div className="space-y-4">
                <h2 className="font-display font-semibold text-lg text-foreground">
                  {t('overview.attention.title')}
                </h2>
                <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg overflow-hidden">
                  {!hasNeedsAttention ? (
                    <div className="p-8 flex flex-col items-center justify-center text-center">
                      <ShieldCheck className="h-8 w-8 text-success mb-2" />
                      <p className="text-sm text-foreground/80">{t('overview.attention.empty')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[hsl(var(--border))]/50">
                      {errorProjects.map((project) => (
                        <div
                          key={project.id}
                          className="p-4 flex items-center gap-3 cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                          onClick={() => navigate(`/projects/${project.id}`)}
                        >
                          <div className="h-2 w-2 rounded-full bg-error shrink-0" />
                          <p className="text-sm text-foreground/80 truncate">
                            {t('overview.attention.projectError').replace('{name}', project.name)}
                          </p>
                        </div>
                      ))}
                      {(stats?.pending_approvals ?? 0) > 0 && (
                        <div
                          className="p-4 flex items-center gap-3 cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                          onClick={() => navigate('/operations?tab=approvals')}
                        >
                          <div className="h-2 w-2 rounded-full bg-warning shrink-0" />
                          <p className="text-sm text-foreground/80 truncate">
                            {t('overview.attention.pendingApprovals').replace(
                              '{count}',
                              String(stats?.pending_approvals),
                            )}
                          </p>
                        </div>
                      )}
                      {(stats?.unhealthy_services ?? 0) > 0 && (
                        <div
                          className="p-4 flex items-center gap-3 cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                          onClick={() => navigate('/services')}
                        >
                          <div className="h-2 w-2 rounded-full bg-error shrink-0" />
                          <p className="text-sm text-foreground/80 truncate">
                            {t('overview.attention.unhealthyServices').replace(
                              '{count}',
                              String(stats?.unhealthy_services),
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Lower Grid: Project Health */}
            <div className="space-y-4">
              <h2 className="font-display font-semibold text-lg text-foreground">
                {t('overview.health.title')}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4 gap-5">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    statusConfig={statusConfig}
                    redeployingIds={redeployingIds}
                    onNavigate={navigate}
                    onRedeploy={handleRedeploy}
                    t={t}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  value,
  label,
  attention,
  onClick,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  attention?: 'warning' | 'critical';
  onClick: () => void;
}) {
  const iconColor =
    attention === 'critical'
      ? 'text-error'
      : attention === 'warning'
        ? 'text-warning'
        : 'text-muted-foreground group-hover:text-agent transition-colors';
  return (
    <div
      onClick={onClick}
      className="group bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-5 min-h-[120px] flex flex-col justify-between gap-3 cursor-pointer hover:bg-bg-panel/80 hover:border-agent/30 transition-all duration-200"
    >
      <div className="flex items-center justify-between">
        <div className={cn('p-2 bg-bg-subtle rounded-md', iconColor)}>{icon}</div>
        <span className="font-display font-bold text-xl text-foreground">{value}</span>
      </div>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function ActivityIcon({ type, severity }: { type: string; severity: string }) {
  // Status/severity encoding — colors preserved (dokploy rule exception)
  if (type === 'incident' || severity === 'critical')
    return <AlertCircle className="h-4 w-4 text-error" />;
  if (type === 'approval' || severity === 'warning')
    return <ShieldCheck className="h-4 w-4 text-warning" />;

  // Decorative / informational — muted (recovery, AI events, default)
  if (type === 'recovery' || type.startsWith('recovery:'))
    return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
  if (type.startsWith('ai')) return <DollarSign className="h-4 w-4 text-muted-foreground" />;
  return <Rocket className="h-4 w-4 text-muted-foreground" />;
}
