import { useState, useEffect } from 'react';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { SystemStats } from '../../monitor/stats.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

export interface UseSystemStatsResult {
  stats: SystemStats | null;
}

/**
 * Poll system stats via IPC client (daemon architecture).
 * Falls back to null if daemon is not connected.
 */
export function useSystemStats(
  client: OpenLanderClient | null,
  intervalMs = 5000,
): UseSystemStatsResult {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const fetch = async () => {
      if (!client) {
        // Daemon not connected — clear stats
        setStats(null);
        return;
      }

      try {
        const response = await client.getSystemStats();
        setStats(response);
      } catch (err) {
        log.debug({ err }, 'Failed to get system stats from daemon');
        // Daemon error — keep existing stats
      }
    };

    void fetch();
    const timer = setInterval(() => {
      void fetch();
    }, intervalMs);
    return () => { clearInterval(timer); };
  }, [client, intervalMs]);

  return { stats };
}
