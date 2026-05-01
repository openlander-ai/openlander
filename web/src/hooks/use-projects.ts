/* eslint-disable openlander-internal/no-dropped-columns */
/**
 * Lint note: reads `project.status` / `project.visibility` off the typed
 * wire shape exposed by `../lib/api`, not the dropped DB columns. The
 * wire layer aliases the dropped projects.* columns from the underlying
 * services row (post-migration 0012) until consumers migrate to
 * getDeployableForProject(projectId). The no-dropped-columns rule is
 * name-based and would misfire here.
 */
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

export interface UseProjectsOptions {
  /** Set to false to disable polling — used by ProjectsGrid when the
   *  "Show archived" toggle is OFF, so the unused archived poller
   *  doesn't waste a request cycle. Defaults to true. */
  enabled?: boolean;
}

export function useProjects(
  includeArchived = false,
  options: UseProjectsOptions = {},
): UseProjectsReturn {
  const { enabled = true } = options;
  const [projects, setProjects] = useState<ProjectWithOptionalEnvironments[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects(includeArchived);
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  const hasBuilding = useMemo(() => projects.some((p) => p.status === 'building'), [projects]);
  const pollMs = hasBuilding ? ACTIVE_POLL_MS : IDLE_POLL_MS;

  // Pass `enabled` straight through; usePollingTask short-circuits when
  // disabled, leaving `projects` at its initial empty array.
  usePollingTask(fetchProjects, { intervalMs: pollMs, enabled });

  return { projects, loading, error, refetch: fetchProjects };
}
