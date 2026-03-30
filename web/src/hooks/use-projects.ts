import { useState, useCallback, useMemo } from 'react';
import { listProjects, type ProjectWithOptionalEnvironments } from '../lib/api';
import { usePollingTask } from './use-polling-task';

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

  const hasBuilding = useMemo(() => projects.some((p) => p.status === 'building'), [projects]);
  const pollMs = hasBuilding ? ACTIVE_POLL_MS : IDLE_POLL_MS;

  usePollingTask(fetchProjects, { intervalMs: pollMs });

  return { projects, loading, error, refetch: fetchProjects };
}
