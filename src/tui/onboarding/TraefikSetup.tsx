import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import type { ScreenProps } from './index.js';

type TraefikState = 'checking' | 'already_running' | 'starting' | 'started' | 'failed';

/**
 * TraefikSetup screen - auto-starts Traefik reverse proxy.
 * Non-fatal if it fails.
 */
export function TraefikSetup({ ctx, onNext }: ScreenProps): React.ReactElement {
  const [state, setState] = useState<TraefikState>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const setupTraefik = async () => {
      try {
        // Check if already running
        const isRunning = await ctx.traefik.isRunning();
        if (isRunning) {
          setState('already_running');
          // Auto-advance after 1.5s
          setTimeout(() => {
            onNext();
          }, 1500);
          return;
        }

        // Try to start
        setState('starting');
        await ctx.traefik.start();
        setState('started');
        // Auto-advance after 1.5s
        setTimeout(() => {
          onNext();
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start Traefik');
        setState('failed');
        // Non-fatal - proceed anyway after 2s
        setTimeout(() => {
          onNext();
        }, 2000);
      }
    };

    setupTraefik();
  }, [ctx, onNext]);

  const renderContent = () => {
    switch (state) {
      case 'checking':
        return (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Checking Traefik...</Text>
          </Box>
        );

      case 'already_running':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="green">✅ Traefik already running</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Continuing...</Text>
            </Box>
          </Box>
        );

      case 'starting':
        return (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Starting Traefik...</Text>
          </Box>
        );

      case 'started':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="green">✅ Traefik started</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Continuing...</Text>
            </Box>
          </Box>
        );

      case 'failed':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text color="yellow">⚠️ Traefik could not start</Text>
            </Box>
            {error && (
              <Box marginBottom={1}>
                <Text dimColor>{error}</Text>
              </Box>
            )}
            <Box>
              <Text dimColor>Continuing anyway (port 80 features may not work)...</Text>
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
            [4/5] Setting up Traefik...
          </Text>
        </Box>

        <Box marginTop={2}>{renderContent()}</Box>
      </Box>
    </Box>
  );
}
