import { createSignal, onCleanup } from 'solid-js';
import type { OpenLanderClient, Project } from '../../ipc/client.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

export interface UseProjectsResult {
  projects: () => Project[];
  loading: () => boolean;
  refresh: () => Promise<void>;
}

/**
 * Poll projects via IPC client (daemon architecture).
 * Falls back to empty array if daemon is not connected.
 */
export function useProjects(
  client: () => OpenLanderClient | null,
  intervalMs = 10000,
): UseProjectsResult {
  const [projects, setProjects] = createSignal<Project[]>([]);
  const [loading, setLoading] = createSignal(true);
  let lastJson = '';

  const refresh = async () => {
    const c = client();
    if (!c) {
      // Daemon not connected — clear projects
      setProjects([]);
      setLoading(false);
      return;
    }

    try {
      const response = await c.listProjects();
      const json = JSON.stringify(response.projects);
      if (json !== lastJson) {
        lastJson = json;
        setProjects(response.projects);
      }
    } catch (err) {
      log.debug({ err }, 'Failed to list projects from daemon');
    } finally {
      setLoading(false);
    }
  };

  void refresh();
  const timer = setInterval(() => {
    void refresh();
  }, intervalMs);

  onCleanup(() => {
    clearInterval(timer);
  });

  return { projects, loading, refresh };
}
