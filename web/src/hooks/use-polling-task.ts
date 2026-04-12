import { useEffect, useRef } from 'react';

export interface UsePollingTaskOptions {
  intervalMs: number;
  enabled?: boolean;
  runOnMount?: boolean;
  pauseWhenHidden?: boolean;
  refetchOnVisible?: boolean;
}

/**
 * Shared polling primitive used across pages/hooks.
 * - Runs immediately on mount by default
 * - Pauses while tab is hidden by default
 * - Refetches once when tab becomes visible again by default
 */
export function usePollingTask(
  task: () => Promise<void> | void,
  {
    intervalMs,
    enabled = true,
    runOnMount = true,
    pauseWhenHidden = true,
    refetchOnVisible = true,
  }: UsePollingTaskOptions,
): void {
  const taskRef = useRef(task);

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const invoke = () => {
      void Promise.resolve(taskRef.current()).catch(() => {
        // Individual callers manage their own error state.
      });
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = () => {
      if (intervalId !== null) return;
      if (pauseWhenHidden && document.visibilityState !== 'visible') return;
      intervalId = setInterval(invoke, intervalMs);
    };

    if (runOnMount) {
      invoke();
    }
    start();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (refetchOnVisible) {
          invoke();
        }
        start();
        return;
      }
      if (pauseWhenHidden) {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [task, enabled, intervalMs, pauseWhenHidden, refetchOnVisible, runOnMount]);
}
