/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * Lint note: reads `service.image` off the typed wire shape exposed by
 * `@/lib/api`, not the dropped DB column. The wire layer aliases
 * services.image_url→image for backward compatibility. The
 * no-dropped-columns rule is name-based and would misfire here.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import {
  Clock,
  HardDrive,
  Box,
  Activity,
  Hash,
  Network,
  Cpu,
  MemoryStick,
  FolderGit2,
  Plug,
} from 'lucide-react';
import {
  getServiceStats,
  getConnectedProjects,
  type Service,
  type ServiceStats,
  type ConnectedProject,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface ServiceOverviewTabProps {
  service: Service;
}

type StatusConfig = { label: string; color: string; dot: string };

function buildStatusConfig(t: (key: string) => string): Record<string, StatusConfig> {
  return {
    running: { label: t('services.status.running'), color: 'text-success', dot: 'bg-success' },
    stopped: {
      label: t('services.status.stopped'),
      color: 'text-muted-foreground',
      dot: 'bg-muted-foreground/40',
    },
    error: { label: t('services.status.error'), color: 'text-error', dot: 'bg-error' },
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function ServiceOverviewTab({ service }: ServiceOverviewTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [connectedProjects, setConnectedProjects] = useState<ConnectedProject[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      try {
        const [statsData, projectsData] = await Promise.all([
          getServiceStats(service.id),
          getConnectedProjects(service.id),
        ]);
        if (mounted) {
          setStats(statsData);
          setConnectedProjects(projectsData);
        }
      } catch (error) {
        console.error('Failed to fetch service data:', error);
      } finally {
        if (mounted) {
          setLoadingStats(false);
          setLoadingProjects(false);
        }
      }
    }
    void fetchData();
    return () => {
      mounted = false;
    };
  }, [service.id]);

  const statusConfig = buildStatusConfig(t);
  const status = statusConfig[service.status] ?? statusConfig.stopped;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Status */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <Activity className="h-3.5 w-3.5" />
            {t('services.detail.overview.status')}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.dot)} />
            <span className={cn('text-sm font-body font-medium', status.color)}>
              {status.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
            <Clock className="h-3 w-3" />
            {service.status === 'running' ? formatRelativeTime(service.created_at) : 'N/A'}
          </div>
        </div>

        {/* Container */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <Box className="h-3.5 w-3.5" />
            {t('services.detail.overview.container')}
          </div>
          <div className="text-sm font-mono text-foreground mb-1">{service.image}</div>
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
            <Hash className="h-3 w-3" />
            {service.container_id ? service.container_id.substring(0, 12) : 'N/A'}
          </div>
        </div>

        {/* CPU */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <Cpu className="h-3.5 w-3.5" />
            {t('services.detail.overview.cpu')}
          </div>
          <div className="text-lg font-mono font-medium text-foreground">
            {loadingStats ? (
              <span className="text-sm animate-pulse text-muted-foreground">
                {t('services.detail.overview.loading')}
              </span>
            ) : stats?.cpuPercent != null ? (
              `${stats.cpuPercent}%`
            ) : (
              <span className="text-sm text-muted-foreground">
                {t('services.detail.overview.na')}
              </span>
            )}
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <MemoryStick className="h-3.5 w-3.5" />
            {t('services.detail.overview.memory')}
          </div>
          <div className="text-lg font-mono font-medium text-foreground">
            {loadingStats ? (
              <span className="text-sm animate-pulse text-muted-foreground">
                {t('services.detail.overview.loading')}
              </span>
            ) : stats?.memoryUsageBytes != null ? (
              formatBytes(stats.memoryUsageBytes)
            ) : (
              <span className="text-sm text-muted-foreground">
                {t('services.detail.overview.na')}
              </span>
            )}
          </div>
          {stats?.memoryLimitBytes != null && (
            <div className="text-xs font-body text-muted-foreground mt-1">
              / {formatBytes(stats.memoryLimitBytes)}
            </div>
          )}
        </div>

        {/* Network */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <Network className="h-3.5 w-3.5" />
            {t('services.detail.overview.network')}
          </div>
          <div className="text-sm font-mono text-foreground">
            {t('services.detail.overview.portLabel', { port: String(service.port) })}
          </div>
          <div className="text-xs font-body text-muted-foreground mt-1">
            {service.container_name}
          </div>
        </div>

        {/* Disk */}
        <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
            <HardDrive className="h-3.5 w-3.5" />
            {t('services.detail.overview.volume')}
          </div>
          <div className="text-lg font-mono font-medium text-foreground">
            {loadingStats ? (
              <span className="text-sm animate-pulse text-muted-foreground">
                {t('services.detail.overview.loading')}
              </span>
            ) : stats?.diskUsageBytes != null ? (
              formatBytes(stats.diskUsageBytes)
            ) : (
              <span className="text-sm text-muted-foreground">
                {t('services.detail.overview.na')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Connections */}
      <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
        <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
          <Plug className="h-3.5 w-3.5" />
          {t('services.detail.overview.connections')}
        </div>
        <div className="text-lg font-mono font-medium text-foreground">
          {loadingStats ? (
            <span className="text-sm animate-pulse text-muted-foreground">
              {t('services.detail.overview.loading')}
            </span>
          ) : stats?.activeConnections != null ? (
            stats.activeConnections
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('services.detail.overview.na')}
            </span>
          )}
        </div>
        {stats?.maxConnections != null && (
          <div className="text-xs font-body text-muted-foreground mt-1">
            {t('services.detail.overview.maxSuffix', { count: String(stats.maxConnections) })}
          </div>
        )}
      </div>

      {/* Connected Projects */}
      <div className="rounded-lg bg-bg-panel border border-[hsl(var(--border))] p-4">
        <div className="flex items-center gap-2 text-xs font-body text-muted-foreground mb-3">
          <FolderGit2 className="h-3.5 w-3.5" />
          {t('services.detail.overview.connectedProjects')}
        </div>
        {loadingProjects ? (
          <div className="text-sm text-muted-foreground animate-pulse">
            {t('services.detail.overview.loading')}
          </div>
        ) : connectedProjects.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('services.detail.noProjectsUsing')}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {connectedProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="flex items-center gap-2 text-sm font-body text-foreground hover:text-agent transition-colors text-left"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-agent shrink-0" />
                {project.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
