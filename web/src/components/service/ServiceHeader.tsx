import { useNavigate } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Play, Square, Trash2, Database, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Service } from '@/lib/api';

interface ServiceHeaderProps {
  service: Service;
  actionLoading: string | null;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}

type StatusConfig = { label: string; color: string; dot: string };

function getStatusConfig(): Record<string, StatusConfig> {
  return {
    running: { label: 'Running', color: 'text-success', dot: 'bg-success' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    error: { label: 'Error', color: 'text-error', dot: 'bg-error' },
  };
}

export function ServiceHeader({
  service,
  actionLoading,
  onStop,
  onStart,
  onDelete,
}: ServiceHeaderProps) {
  const navigate = useNavigate();
  const statusConfig = getStatusConfig();
  const status = statusConfig[service.status] ?? statusConfig.stopped;
  const isRunning = service.status === 'running';
  const isStopped = service.status === 'stopped';

  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/services')}
            className="shrink-0 p-1 rounded hover:bg-secondary-ol/10 text-secondary-ol hover:text-primary-ol transition-colors"
            title="Back to Services"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className={cn('h-3 w-3 rounded-full shrink-0', status.dot)} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate">
                {service.name}
              </h1>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary-ol/10 border border-secondary-ol/20 text-xs font-mono text-secondary-ol">
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
              Start
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
              Stop
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
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
