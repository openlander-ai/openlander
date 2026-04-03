import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Cpu,
  Container,
  Network,
  Archive,
  X,
  Loader2,
} from 'lucide-react';
import type { Notification } from '@/hooks/use-notifications';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';

interface NotificationCenterProps {
  notifications: Notification[];
  onDismiss: (id: string) => Promise<void>;
  onAction?: (notification: Notification, action: string) => void;
}

const severityConfig = {
  warning: {
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    severityIcon: AlertTriangle,
    iconColor: 'text-warning',
    titleColor: 'text-warning',
    badgeBg: 'bg-warning/15 text-warning',
  },
  critical: {
    bg: 'bg-error/5',
    border: 'border-error/20',
    severityIcon: AlertCircle,
    iconColor: 'text-error',
    titleColor: 'text-error',
    badgeBg: 'bg-error/15 text-error',
  },
} as const;

const typeIcons: Record<Notification['type'], typeof AlertCircle> = {
  'container-crash': AlertCircle,
  'restart-loop': RefreshCw,
  'resource-saturation': Cpu,
  disk: HardDrive,
  'inactive-project': Archive,
  'dangling-images': Container,
  'port-conflict': Network,
  'orphan-container': Container,
};

const typeLabels: Record<Notification['type'], string> = {
  'container-crash': 'Container Crash',
  'restart-loop': 'Restart Loop',
  'resource-saturation': 'Resource Saturation',
  disk: 'Low Disk Space',
  'inactive-project': 'Inactive Project',
  'dangling-images': 'Unused Images',
  'port-conflict': 'Port Conflict',
  'orphan-container': 'Orphan Container',
};

/** Action suggestions by alert type */
function getActions(type: Notification['type']): Array<{ label: string; action: string }> {
  switch (type) {
    case 'container-crash':
      return [{ label: 'View Logs', action: 'view_logs' }];
    case 'restart-loop':
      return [{ label: 'View Logs', action: 'view_logs' }];
    case 'resource-saturation':
      return [{ label: 'View Details', action: 'view_stats' }];
    case 'disk':
      return [{ label: 'Clean Up', action: 'cleanup_disk' }];
    case 'dangling-images':
      return [{ label: 'Clean Up', action: 'cleanup_images' }];
    case 'orphan-container':
      return [{ label: 'View Details', action: 'view_details' }];
    default:
      return [];
  }
}

export function NotificationCenter({
  notifications,
  onDismiss,
  onAction,
}: NotificationCenterProps) {
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const handleDismiss = async (id: string) => {
    setDismissingId(id);
    try {
      await onDismiss(id);
    } finally {
      setDismissingId(null);
    }
  };

  if (notifications.length === 0) {
    return (
      <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-[hsl(var(--border))] bg-bg-panel shadow-xl z-[60]">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-xs font-display font-semibold text-primary-ol">Notifications</h3>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-muted-ol font-body">No notifications</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 max-h-[420px] rounded-lg border border-[hsl(var(--border))] bg-bg-panel shadow-xl z-[60] flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[hsl(var(--border))] shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-display font-semibold text-primary-ol">Notifications</h3>
          <span className="text-xs font-mono text-muted-ol">{notifications.length}</span>
        </div>
      </div>

      {/* Notification list */}
      <div className="overflow-y-auto flex-1">
        {notifications.map((notification) => {
          const config = severityConfig[notification.severity] ?? severityConfig.warning;
          const TypeIcon = typeIcons[notification.type] ?? AlertCircle;
          const actions = getActions(notification.type);

          return (
            <div
              key={notification.id}
              className={cn(
                'px-4 py-3 border-b border-[hsl(var(--border))] last:border-b-0 transition-colors',
                config.bg,
              )}
            >
              <div className="flex items-start gap-2.5">
                {/* Type icon */}
                <div className="shrink-0 mt-0.5">
                  <TypeIcon className={cn('h-3.5 w-3.5', config.iconColor)} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('text-xs font-body leading-snug', config.titleColor)}>
                      {notification.message}
                    </p>
                    <button
                      onClick={() => void handleDismiss(notification.id)}
                      disabled={dismissingId !== null}
                      className="shrink-0 p-0.5 rounded hover:bg-bg-subtle transition-colors text-muted-ol hover:text-secondary-ol"
                      title="Dismiss"
                    >
                      {dismissingId === notification.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  {/* Suggestion */}
                  {notification.suggestion && (
                    <p className="mt-1 text-sm font-body text-secondary-ol leading-relaxed">
                      {notification.suggestion}
                    </p>
                  )}

                  {/* Footer: badge + actions + time */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className={cn('text-xs font-mono px-1.5 py-0.5 rounded', config.badgeBg)}>
                      {typeLabels[notification.type]}
                    </span>

                    {actions.map((action) => (
                      <button
                        key={action.action}
                        onClick={() => onAction?.(notification, action.action)}
                        className="text-xs font-body text-agent hover:text-agent/80 transition-colors underline underline-offset-2"
                      >
                        {action.label}
                      </button>
                    ))}

                    <span className="ml-auto text-xs font-mono text-muted-ol">
                      {formatTime(notification.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
