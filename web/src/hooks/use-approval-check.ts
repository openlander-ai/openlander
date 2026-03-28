import { useState, useEffect, useCallback } from 'react';
import {
  getPendingApprovals,
  approveRecovery,
  rejectRecovery,
  type PendingApproval,
} from '../lib/api/usage';

const IDLE_POLL_MS = 10_000;

export interface UseApprovalCheckReturn {
  pendingApprovals: PendingApproval[];
  approve: (projectId: string, actionRunId: string) => Promise<void>;
  reject: (projectId: string, actionRunId: string) => Promise<void>;
}

export function useApprovalCheck(): UseApprovalCheckReturn {
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);

  const fetchApprovals = useCallback(async () => {
    try {
      const approvals = await getPendingApprovals();
      setPendingApprovals(approvals);
    } catch (err) {
      console.error('Failed to fetch pending approvals:', err);
    }
  }, []);

  useEffect(() => {
    void fetchApprovals();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchApprovals();
      }
    }, IDLE_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchApprovals();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchApprovals]);

  const approve = async (projectId: string, actionRunId: string) => {
    try {
      await approveRecovery(projectId, actionRunId);
      void fetchApprovals();
    } catch (err) {
      console.error('Failed to approve recovery action:', err);
      throw err;
    }
  };

  const reject = async (projectId: string, actionRunId: string) => {
    try {
      await rejectRecovery(projectId, actionRunId);
      void fetchApprovals();
    } catch (err) {
      console.error('Failed to reject recovery action:', err);
      throw err;
    }
  };

  return { pendingApprovals, approve, reject };
}
