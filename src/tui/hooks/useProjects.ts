import { useState, useEffect, useCallback } from 'react';
import type { Database, ProjectRow } from '../../db/index.js';

export interface UseProjectsResult {
  projects: ProjectRow[];
  loading: boolean;
  refresh: () => void;
}

/**
 * Poll the database for projects every `intervalMs`.
 * TUI accesses DB directly — no HTTP calls.
 */
export function useProjects(db: Database, intervalMs = 3000): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    try {
      const rows = db.listProjects();
      setProjects(rows);
    } catch {
      // DB not ready yet — ignore
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { projects, loading, refresh };
}
