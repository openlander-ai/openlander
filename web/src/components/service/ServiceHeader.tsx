import { useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Play, Square, Trash2, Database, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getStatusDisplay } from '@/lib/status-config';
import type { Service } from '@/lib/api';
import { useLanguage } from '@/i18n/context';

interface ServiceHeaderProps {
  service: Service;
  actionLoading: string | null;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}

type StatusConfig = { label: string; color: string; dot: string };

function buildStatusConfig(t: (key: string) => string): Record<string, StatusConfig> {
  const labels: Record<string, string> = {
    running: t('services.status.running'),
    stopped: t('services.status.stopped'),
    error: t('services.status.error'),
  };
  const out: Record<string, StatusConfig> = {};
  for (const key of Object.keys(labels)) {
    const def = getStatusDisplay(key);
    out[key] = { label: labels[key], color: def.textClass, dot: def.dot };
  }
  return out;
}

export function ServiceHeader({
  service,
  actionLoading,
  onStop,
  onStart,
  onDelete,
}: ServiceHeaderProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const statusConfig = buildStatusConfig(t);
  const status = statusConfig[service.status] ?? statusConfig.stopped;
  const isRunning = service.status === 'running';
  const isStopped = service.status === 'stopped';

  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/services')}
            className="shrink-0 p-1 rounded hover:bg-muted text-secondary-ol hover:text-primary-ol transition-colors"
            title={t('services.detail.header.backToServices')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
                {service.name}
              </h1>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted border border-border text-xs font-mono text-secondary-ol">
                <Database className="h-3 w-3" />
                {service.image}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs font-body text-secondary-ol">
              <span className={status.color}>{status.label}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isStopped && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-body gap-1.5 text-success hover:text-success hover:bg-success/10 hover:border-success/30"
              onClick={onStart}
              disabled={!!actionLoading}
            >
              {actionLoading === 'start' ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {t('services.detail.header.start')}
            </Button>
          )}

          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-body gap-1.5 text-warning hover:text-warning hover:bg-warning/10 hover:border-warning/30"
              onClick={onStop}
              disabled={!!actionLoading}
            >
              {actionLoading === 'stop' ? (
                <Spinner className="h-3 w-3" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              {t('services.detail.header.stop')}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-body gap-1.5 text-error hover:text-error hover:bg-error/10 hover:border-error/30"
            onClick={onDelete}
            disabled={!!actionLoading}
          >
            {actionLoading === 'delete' ? (
              <Spinner className="h-3 w-3" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            {t('services.detail.header.delete')}
          </Button>
        </div>
      </div>
    </div>
  );
}
