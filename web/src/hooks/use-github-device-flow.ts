import { useCallback, useEffect, useRef, useState } from 'react';

import { pollGithubDeviceFlow, startGithubDeviceFlow } from '@/lib/api';

const DEFAULT_START_ERROR_MESSAGE = 'Failed to start GitHub authorization';

export interface GithubDeviceFlowState {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}

export interface UseGithubDeviceFlowOptions {
  onComplete?: () => Promise<void> | void;
  startErrorMessage?: string;
}

export function useGithubDeviceFlow({
  onComplete,
  startErrorMessage = DEFAULT_START_ERROR_MESSAGE,
}: UseGithubDeviceFlowOptions = {}) {
  const [deviceFlow, setDeviceFlow] = useState<GithubDeviceFlowState | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);
  const [githubError, setGithubError] = useState('');
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const resetDeviceFlow = useCallback(() => {
    setDeviceFlow(null);
    setDeviceFlowPolling(false);
  }, []);

  const cancelDeviceFlow = useCallback(() => {
    resetDeviceFlow();
    setGithubError('');
  }, [resetDeviceFlow]);

  const startDeviceFlow = useCallback(async () => {
    setGithubError('');
    try {
      const response = await startGithubDeviceFlow();
      setDeviceFlow({
        userCode: response.user_code,
        verificationUri: response.verification_uri,
        deviceCode: response.device_code,
        interval: response.interval,
      });
      setDeviceFlowPolling(true);
    } catch {
      setGithubError(startErrorMessage);
    }
  }, [startErrorMessage]);

  useEffect(() => {
    if (!deviceFlowPolling || !deviceFlow) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await pollGithubDeviceFlow(deviceFlow.deviceCode, deviceFlow.interval);

        if (result.status === 'complete') {
          clearInterval(pollInterval);
          resetDeviceFlow();
          await onCompleteRef.current?.();
          return;
        }

        if (result.status === 'slow_down') {
          setDeviceFlow((prev) =>
            prev ? { ...prev, interval: result.interval ?? prev.interval } : prev,
          );
          return;
        }

        if (
          result.status === 'expired' ||
          result.status === 'denied' ||
          result.status === 'error'
        ) {
          clearInterval(pollInterval);
          resetDeviceFlow();
          setGithubError(result.message || `Authorization ${result.status}`);
        }
      } catch {
        // Ignore transient network errors and continue polling.
      }
    }, deviceFlow.interval * 1000);

    return () => clearInterval(pollInterval);
  }, [deviceFlowPolling, deviceFlow, resetDeviceFlow]);

  return {
    deviceFlow,
    deviceFlowPolling,
    githubError,
    setGithubError,
    startDeviceFlow,
    cancelDeviceFlow,
    resetDeviceFlow,
  } as const;
}
