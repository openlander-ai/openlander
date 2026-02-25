import { useState, useEffect } from 'react';
import { getSystemStats } from '../../monitor/stats.js';
import type { SystemStats } from '../../monitor/stats.js';

export interface UseSystemStatsResult {
  stats: SystemStats | null;
}

/**
 * Poll system stats (CPU, RAM, disk) every `intervalMs`.
 */
export function useSystemStats(intervalMs = 5000): UseSystemStatsResult {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    const fetch = () => {
      try {
        setStats(getSystemStats());
      } catch {
        // Ignore stats errors
      }
    };
    fetch();
    const timer = setInterval(fetch, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return { stats };
}
