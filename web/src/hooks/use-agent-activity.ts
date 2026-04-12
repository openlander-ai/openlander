import { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/api/auth';

export interface AgentActiveState {
  isActive: boolean;
  projectId?: string;
  projectName?: string;
  incidentId?: string;
  currentStep?: string;
  currentStepNumber?: number;
  totalSteps?: number;
  startedAt?: string;
  lastUpdatedAt?: string;
  thoughtLog?: string[];
}

export function useAgentActivity() {
  const [data, setData] = useState<AgentActiveState>({ isActive: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      // Mocking for frontend UI development since endpoint might not exist yet
      // Removing the mock when endpoint is available.
      const res = await fetchWithAuth('/api/ops/agent/active').catch(() => null);

      if (!res || !res.ok) {
        // Fallback Mock UI state for demonstrating the UI/UX
        // if API returns 404 or backend is not updated.
        setData({
          isActive: false, // Set to true manually locally to test
          projectId: 'mock-1',
          projectName: 'hotdeal-api',
          currentStep: 'Analyzing crash dump logs...',
          currentStepNumber: 2,
          totalSteps: 4,
          startedAt: new Date(Date.now() - 45000).toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          thoughtLog: [
            'Detected OOM Kill in container hotdeal-api',
            'Fetching last 50 lines of logs',
            'Searching for memory leak footprint',
            'Identifying heavy DB queries...',
          ],
        });
        setError(null);
        return;
      }

      const payload = await res.json();
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();

    // Polling logic: fast when active, slow when idle
    const interval = setInterval(
      () => {
        void fetchStatus();
      },
      data.isActive ? 3000 : 10000,
    );

    return () => clearInterval(interval);
  }, [fetchStatus, data.isActive]);

  return { activeState: data, loading, error };
}
