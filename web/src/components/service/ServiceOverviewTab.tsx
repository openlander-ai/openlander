import { useEffect, useState } from 'react';
import { Clock, HardDrive, Box, Activity, Hash, Network } from 'lucide-react';
import { getServiceStats, type Service, type ServiceStats } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';

interface ServiceOverviewTabProps {
  service: Service;
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(): Record<string, StatusConfig> {
  return {
    running: { label: 'Running', color: 'text-success', dot: 'bg-success' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    error: { label: 'Error', color: 'text-error', dot: 'bg-error' },
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
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchStats() {
      try {
        const data = await getServiceStats(service.id);
        if (mounted) {
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch service stats:', error);
      } finally {
        if (mounted) {
          setLoadingStats(false);
        }
      }
    }
    void fetchStats();
    return () => {
      mounted = false;
    };
  }, [service.id]);

  const statusConfig = getStatusConfig();
  const status = statusConfig[service.status] ?? statusConfig.stopped;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Card 1: Status & Uptime */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-ol" />
          Status
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.dot)} />
            <span className={cn('text-sm font-body', status.color)}>{status.label}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-body">
            <Clock className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-muted-ol w-16">Uptime:</span>
            <span className="text-secondary-ol">
              {service.status === 'running' ? formatRelativeTime(service.created_at) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Card 2: Container Info */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3 flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-ol" />
          Container Info
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-body">
            <span className="text-muted-ol w-20">Image:</span>
            <span className="text-secondary-ol font-mono text-xs bg-bg-panel px-1.5 py-0.5 rounded border border-[hsl(var(--border))]">
              {service.image}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm font-body">
            <Hash className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-muted-ol w-16">ID:</span>
            <span className="text-secondary-ol font-mono text-xs">
              {service.container_id ? service.container_id.substring(0, 12) : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Card 3: Network & Storage */}
      <div className="rounded-lg bg-bg-panel/50 border border-[hsl(var(--border))] p-4">
        <h3 className="text-sm font-display font-medium text-primary-ol mb-3 flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-ol" />
          Network & Storage
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-body">
            <span className="text-muted-ol w-20">Port:</span>
            <span className="text-secondary-ol">{service.port}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-body">
            <HardDrive className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-muted-ol w-16">Disk:</span>
            <span className="text-secondary-ol">
              {loadingStats ? (
                <span className="animate-pulse">Loading...</span>
              ) : stats?.diskUsageBytes != null ? (
                `${formatBytes(stats.diskUsageBytes)} / 20 GB`
              ) : (
                'N/A'
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
