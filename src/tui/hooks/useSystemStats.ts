import { createSignal, onCleanup } from 'solid-js';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { SystemStats } from '../../monitor/stats.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

export interface UseSystemStatsResult {
  stats: () => SystemStats | null;
}

/**
 * Poll system stats via IPC client (daemon architecture).
 * Falls back to null if daemon is not connected.
 */
export function useSystemStats(
  client: () => OpenLanderClient | null,
  intervalMs = 10000,
): UseSystemStatsResult {
  const [stats, setStats] = createSignal<SystemStats | null>(null);
  let lastJson = '';

  const fetchStats = async () => {
    const c = client();
    if (!c) {
      if (lastJson !== '') {
        setStats(null);
        lastJson = '';
      }
      return;
    }

    try {
      const response = await c.getSystemStats();
      const json = JSON.stringify(response);
      if (json !== lastJson) {
        lastJson = json;
        setStats(response);
      }
    } catch (err) {
      log.debug({ err }, 'Failed to get system stats from daemon');
    }
  };

  void fetchStats();
  const timer = setInterval(() => {
    void fetchStats();
  }, intervalMs);

  onCleanup(() => {
    clearInterval(timer);
  });

  return { stats };
}
