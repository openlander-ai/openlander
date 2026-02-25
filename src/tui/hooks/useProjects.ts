import { useState, useEffect, useCallback, useRef } from 'react';
import type { OpenLanderClient, Project } from '../../ipc/client.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Poll projects via IPC client (daemon architecture).
 * Falls back to empty array if daemon is not connected.
 */
export function useProjects(
  client: OpenLanderClient | null,
  intervalMs = 10000,
): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const lastJsonRef = useRef('');

  const refresh = useCallback(async () => {
    if (!client) {
      // Daemon not connected — clear projects
      setProjects([]);
      setLoading(false);
      return;
    }

    try {
      const response = await client.listProjects();
      const json = JSON.stringify(response.projects);
      if (json !== lastJsonRef.current) {
        lastJsonRef.current = json;
        setProjects(response.projects);
      }
    } catch (err) {
      log.debug({ err }, 'Failed to list projects from daemon');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { projects, loading, refresh };
}
