import { useState, useEffect } from 'react';
import type { SystemStats } from '../types';

export interface UseSystemStatsReturn {
  stats: SystemStats | null;
  loading: boolean;
  error: Error | null;
}

export function useSystemStats(): UseSystemStatsReturn {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/system/stats');
        if (!response.ok) {
          throw new Error(`Failed to fetch system stats: ${response.statusText}`);
        }
        const data = await response.json();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const intervalId = setInterval(fetchStats, 30000);

    return () => clearInterval(intervalId);
  }, []);

  return { stats, loading, error };
}
