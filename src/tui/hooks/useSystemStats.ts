import { useState, useEffect, useRef } from 'react';
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
  intervalMs = 10000,
): UseSystemStatsResult {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const lastJsonRef = useRef('');

  useEffect(() => {
    const fetchStats = async () => {
      if (!client) {
        if (lastJsonRef.current !== '') {
          setStats(null);
          lastJsonRef.current = '';
        }
        return;
      }

      try {
        const response = await client.getSystemStats();
        const json = JSON.stringify(response);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
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
    return () => {
      clearInterval(timer);
    };
  }, [client, intervalMs]);

  return { stats };
}
