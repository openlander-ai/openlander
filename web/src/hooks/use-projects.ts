import { useState, useEffect, useCallback } from 'react';
import { listProjects, type ProjectWithOptionalEnvironments } from '../lib/api';

const IDLE_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;

export interface UseProjectsReturn {
  projects: ProjectWithOptionalEnvironments[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<ProjectWithOptionalEnvironments[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();

    // Poll faster when any project is building
    const hasBuilding = projects.some((p) => p.status === 'building');
    const pollMs = hasBuilding ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const interval = setInterval(fetchProjects, pollMs);

    // Refetch on tab focus
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void fetchProjects();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchProjects, projects.some((p) => p.status === 'building')]);

  return { projects, loading, error, refetch: fetchProjects };
}
