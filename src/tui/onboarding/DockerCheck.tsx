import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';

import type { ScreenProps } from './index.js';
import type { DockerStatus } from '../../pipeline/docker.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

type CheckState = 'checking' | 'success' | 'not_installed' | 'not_running' | 'permission_denied';

/**
 * DockerCheck screen - auto-detects Docker installation and daemon status.
 * Shows spinner during check, then displays result.
 */
export function DockerCheck({ ctx, onNext }: ScreenProps): React.ReactElement {
  const { exit } = useApp();
  const [state, setState] = useState<CheckState>('checking');
  const [retryCount, setRetryCount] = useState(0);

  const checkDocker = useCallback(async () => {
    setState('checking');
    try {
      const status: DockerStatus = await ctx.docker.status();

      if (status.state === 'running') {
        setState('success');
        setState('success');
        // Auto-advance after 1s
        setTimeout(() => {
          onNext();
        }, 1000);
      } else if (status.state === 'not_installed') {
        setState('not_installed');
      } else if (status.state === 'not_running') {
        setState('not_running');
      } else {
        setState('permission_denied');
      }
    } catch (err) {
      log.debug({ err }, 'Docker status check failed');
      setState('not_installed');
      setState('not_installed');
    }
  }, [ctx.docker, onNext]);

  useEffect(() => {
    void checkDocker();
  }, [retryCount]);

  useInput((input, key) => {
    if (state === 'success') {
      if (key.return) {
        onNext();
      }
      return;
    }

    if (key.return) {
      setRetryCount((c) => c + 1);
    }
    if (input.toLowerCase() === 'q') {
      exit();
    }
  });

  const renderContent = () => {
    switch (state) {
      case 'checking':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="yellow">
                <Spinner type="dots" />
              </Text>
              <Text> Checking Docker...</Text>
            </Box>
          </Box>
        );

      case 'success':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="green">✅ Docker detected</Text>
            </Box>
            <Box>
              <Text color="green">✅ Docker daemon running</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Continuing automatically...</Text>
            </Box>
          </Box>
        );

      case 'not_installed':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text color="red">❌ Docker not found</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Please install Docker to continue:</Text>
            </Box>
            <Box marginBottom={1}>
              <Text color="cyan">https://docs.docker.com/get-docker/</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Or run: curl -fsSL https://get.docker.com | sh</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="cyan" bold>
                [Enter]
              </Text>
              <Text> Retry</Text>
              <Text dimColor> [q] Quit</Text>
            </Box>
          </Box>
        );

      case 'not_running':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text color="yellow">⚠️ Docker installed but not running</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Please start the Docker daemon:</Text>
            </Box>
            <Box marginBottom={1}>
              <Text color="cyan">sudo systemctl start docker</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>(or open Docker Desktop on macOS)</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="cyan" bold>
                [Enter]
              </Text>
              <Text> Retry</Text>
              <Text dimColor> [q] Quit</Text>
            </Box>
          </Box>
        );

      case 'permission_denied':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text color="yellow">⚠️ Docker permission denied</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Add your user to the docker group:</Text>
            </Box>
            <Box marginBottom={1}>
              <Text color="cyan">sudo usermod -aG docker $USER</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>Then log out and back in.</Text>
            </Box>
            <Box marginTop={2}>
              <Text color="cyan" bold>
                [Enter]
              </Text>
              <Text> Retry</Text>
              <Text dimColor> [q] Quit</Text>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            [1/5] Checking Docker...
          </Text>
        </Box>

        <Box marginTop={2}>{renderContent()}</Box>
      </Box>
    </Box>
  );
}
