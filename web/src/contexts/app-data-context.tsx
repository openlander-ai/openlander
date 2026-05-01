import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ProjectsContext } from '@/contexts/projects-context';
import { useNotifications, type Notification } from '@/hooks/use-notifications';
import { usePollingTask } from '@/hooks/use-polling-task';
import { useProjects, type UseProjectsReturn } from '@/hooks/use-projects';
import { useSystemStats } from '@/hooks/use-system-stats';
import { useSystemStatus } from '@/hooks/use-system-status';
import { fetchPendingApprovals, type ActionRun } from '@/lib/api/projects';
import type { ServerStatus, SetupStatus } from '@/lib/api/system';
import { subscribeLlmChanged } from '@/lib/llm-events';
import type { SystemStats } from '@/types';

interface PendingApprovalsState {
  pendingApprovals: ActionRun[];
  pendingApprovalsLoading: boolean;
  pendingApprovalsError: string | null;
  refreshPendingApprovals: () => Promise<void>;
}

export interface AppDataContextValue extends PendingApprovalsState {
  projectsState: UseProjectsReturn;
  projects: UseProjectsReturn['projects'];
  projectsLoading: boolean;
  projectsError: string | null;
  refreshProjects: UseProjectsReturn['refetch'];
  serverStatus: ServerStatus | null;
  setupStatus: SetupStatus | null;
  systemStatusLoading: boolean;
  systemStatusError: string | null;
  refreshSetupStatus: () => void;
  stats: SystemStats | null;
  statsLoading: boolean;
  statsError: Error | null;
  notifications: Notification[];
  unreadCount: number;
  notificationsLoading: boolean;
  notificationsError: Error | null;
  dismissNotification: (id: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AppDataContext = createContext<AppDataContextValue | null>(null);

function usePendingApprovalsState(): PendingApprovalsState {
  const [pendingApprovals, setPendingApprovals] = useState<ActionRun[]>([]);
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(true);
  const [pendingApprovalsError, setPendingApprovalsError] = useState<string | null>(null);

  const refreshPendingApprovals = useCallback(async () => {
    try {
      const runs = await fetchPendingApprovals();
      setPendingApprovals(runs);
      setPendingApprovalsError(null);
    } catch (err) {
      setPendingApprovalsError(
        err instanceof Error ? err.message : 'Failed to fetch pending approvals',
      );
    } finally {
      setPendingApprovalsLoading(false);
    }
  }, []);

  usePollingTask(refreshPendingApprovals, { intervalMs: 5_000 });

  return {
    pendingApprovals,
    pendingApprovalsLoading,
    pendingApprovalsError,
    refreshPendingApprovals,
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const projectsState = useProjects(false);
  const systemStatusState = useSystemStatus();
  const statsState = useSystemStats();
  const notificationsState = useNotifications();
  const pendingState = usePendingApprovalsState();

  useEffect(() => {
    const unsubscribe = subscribeLlmChanged(() => {
      void systemStatusState.refetch();
    });
    return () => unsubscribe();
  }, [systemStatusState.refetch]);

  const value = useMemo<AppDataContextValue>(
    () => ({
      projectsState,
      projects: projectsState.projects,
      projectsLoading: projectsState.loading,
      projectsError: projectsState.error,
      refreshProjects: projectsState.refetch,
      serverStatus: systemStatusState.serverStatus,
      setupStatus: systemStatusState.setupStatus,
      systemStatusLoading: systemStatusState.loading,
      systemStatusError: systemStatusState.error,
      refreshSetupStatus: systemStatusState.refetch,
      stats: statsState.stats,
      statsLoading: statsState.loading,
      statsError: statsState.error,
      notifications: notificationsState.notifications,
      unreadCount: notificationsState.unreadCount,
      notificationsLoading: notificationsState.loading,
      notificationsError: notificationsState.error,
      dismissNotification: notificationsState.dismiss,
      refreshNotifications: notificationsState.refresh,
      ...pendingState,
    }),
    [notificationsState, pendingState, projectsState, statsState, systemStatusState],
  );

  return (
    <AppDataContext.Provider value={value}>
      <ProjectsContext.Provider value={projectsState}>{children}</ProjectsContext.Provider>
    </AppDataContext.Provider>
  );
}
