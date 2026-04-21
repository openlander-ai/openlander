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
import { formatRelativeTime } from '@/lib/time';

interface OverviewStats {
  active_deploys: number;
  active_recoveries: number;
  pending_approvals: number;
  open_incidents: number;
  unhealthy_services: number;
  ai_spend_today: number;
}

function getStatusConfig(): Record<
  string,
  { label: string; dot: string; badge: string; border: string }
> {
  return {
    running: {
      label: 'Healthy',
      dot: 'bg-success animate-pulse',
      badge: 'bg-success/10 text-success border border-success/30',
      border: 'border-success/20',
    },
    stopped: {
      label: 'Stopped',
      dot: 'bg-[var(--text-muted)]',
      badge: 'bg-bg-subtle text-muted-ol border border-border',
      border: 'border-[hsl(var(--border))]',
    },
    building: {
      label: 'Deploying',
      dot: 'bg-warning animate-pulse-ring',
      badge: 'bg-warning/10 text-warning border border-warning/30',
      border: 'border-warning/30',
    },
    error: {
      label: 'Failed',
      dot: 'bg-error',
      badge: 'bg-error/10 text-error border border-error/30',
      border: 'border-error/30',
    },
  };
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
      <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-8">
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
    );
  }

  return (
    <div className="p-6 xl:p-8 max-w-7xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-2xl text-primary-ol tracking-tight">
          {t('overview.title')}
        </h1>
      </div>

      {/* KPI Row */}
      <div data-testid="kpi-row" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          icon={<Rocket className="h-5 w-5 text-blue-500" />}
          value={stats?.active_deploys ?? 0}
          label={t('overview.kpi.activeDeploys')}
          onClick={() => navigate('/deployments')}
        />
        <KpiCard
          icon={<RefreshCw className="h-5 w-5 text-purple-500" />}
          value={stats?.active_recoveries ?? 0}
          label={t('overview.kpi.recoveries')}
          onClick={() => navigate('/operations')}
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5 text-amber-500" />}
          value={stats?.pending_approvals ?? 0}
          label={t('overview.kpi.approvals')}
          onClick={() => navigate('/operations?tab=approvals')}
        />
        <KpiCard
          icon={<AlertCircle className="h-5 w-5 text-red-500" />}
          value={stats?.open_incidents ?? 0}
          label={t('overview.kpi.incidents')}
          onClick={() => navigate('/operations?tab=incidents')}
        />
        <KpiCard
          icon={<HeartOff className="h-5 w-5 text-orange-500" />}
          value={stats?.unhealthy_services ?? 0}
          label={t('overview.kpi.services')}
          onClick={() => navigate('/services')}
        />
        <KpiCard
          icon={<DollarSign className="h-5 w-5 text-emerald-500" />}
          value={`$${(stats?.ai_spend_today ?? 0).toFixed(2)}`}
          label={t('overview.kpi.aiSpend')}
          onClick={() => navigate('/operations?tab=usage')}
        />
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-[hsl(var(--border))] rounded-lg bg-bg-panel">
          <Rocket className="h-12 w-12 text-muted-ol mb-4" />
          <p className="text-secondary-ol max-w-md">{t('overview.empty')}</p>
        </div>
      ) : (
        <>
          {/* Main 2-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Live Activity */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="font-display font-semibold text-lg text-primary-ol">
                {t('overview.activity.title')}
              </h2>
              <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg overflow-hidden">
                {activities.length === 0 ? (
                  <div className="p-8 text-center text-muted-ol">
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
                            <p className="text-sm font-medium text-primary-ol truncate">
                              {activity.title}
                            </p>
                            <span className="text-xs text-muted-ol whitespace-nowrap">
                              {t('overview.activity.timeAgo').replace(
                                '{time}',
                                formatRelativeTime(activity.timestamp, t),
                              )}
                            </span>
                          </div>
                          <p className="text-xs text-secondary-ol mt-1 truncate">
                            <span className="font-medium text-primary-ol mr-2">
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
              <h2 className="font-display font-semibold text-lg text-primary-ol">
                {t('overview.attention.title')}
              </h2>
              <div className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg overflow-hidden">
                {!hasNeedsAttention ? (
                  <div className="p-8 flex flex-col items-center justify-center text-center">
                    <ShieldCheck className="h-8 w-8 text-success mb-2" />
                    <p className="text-sm text-secondary-ol">{t('overview.attention.empty')}</p>
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
                        <p className="text-sm text-secondary-ol truncate">
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
                        <p className="text-sm text-secondary-ol truncate">
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
                        <p className="text-sm text-secondary-ol truncate">
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
            <h2 className="font-display font-semibold text-lg text-primary-ol">
              {t('overview.health.title')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
  );
}

function KpiCard({
  icon,
  value,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-4 flex flex-col gap-2 cursor-pointer hover:bg-bg-panel/80 hover:border-agent/30 transition-all duration-200"
    >
      <div className="flex items-center justify-between">
        <div className="p-2 bg-bg-subtle rounded-md">{icon}</div>
        <span className="font-display font-bold text-xl text-primary-ol">{value}</span>
      </div>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function ActivityIcon({ type, severity }: { type: string; severity: string }) {
  if (type === 'incident') return <AlertCircle className="h-4 w-4 text-error" />;
  if (type === 'recovery' || type.startsWith('recovery:'))
    return <RefreshCw className="h-4 w-4 text-purple-500" />;
  if (type === 'approval') return <ShieldCheck className="h-4 w-4 text-warning" />;
  if (type.startsWith('ai')) return <DollarSign className="h-4 w-4 text-emerald-500" />;

  if (severity === 'critical') return <AlertCircle className="h-4 w-4 text-error" />;
  if (severity === 'warning') return <AlertCircle className="h-4 w-4 text-warning" />;
  return <Rocket className="h-4 w-4 text-blue-500" />;
}
