import { useState, useCallback } from 'react';
import { usePollingTask } from './use-polling-task';

export interface Notification {
  id: string;
  type:
    | 'disk'
    | 'inactive-project'
    | 'restart-loop'
    | 'dangling-images'
    | 'port-conflict'
    | 'container-crash'
    | 'resource-saturation'
    | 'orphan-container';
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  suggestion: string;
  createdAt: string;
  dismissed: boolean;
}

export interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: Error | null;
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts');
      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.statusText}`);
      }
      const data = await response.json();
      setNotifications(data.alerts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/alerts/${id}/dismiss`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Failed to dismiss alert: ${response.statusText}`);
      }
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to dismiss'));
    }
  }, []);

  usePollingTask(fetchAlerts, { intervalMs: POLL_INTERVAL_MS });

  const unreadCount = notifications.filter((n) => !n.dismissed).length;

  return { notifications, unreadCount, loading, error, dismiss, refresh: fetchAlerts };
}
