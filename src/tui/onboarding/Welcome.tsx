import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';

import { VERSION } from './version.js';

export interface WelcomeProps {
  onNext: () => void;
}

/**
 * Welcome screen - first screen of the onboarding wizard.
 * Shows version, tagline, and prompts user to press Enter.
 */
export function Welcome({ onNext }: WelcomeProps): React.ReactElement {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.return) {
      onNext();
    }
    if (input.toLowerCase() === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🛬 OpenLander
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>v{VERSION}</Text>
        </Box>

        <Box marginBottom={2}>
          <Text italic color="gray">
            Give any coding agent the power to deploy
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
        </Box>

        <Box marginTop={2} flexDirection="column" alignItems="center">
          <Text color="gray">OpenLander helps you deploy apps from any AI coding tool.</Text>
          <Text color="gray">Clone, build, and run — all from a chat.</Text>
        </Box>

        <Box marginTop={2}>
          <Text color="green" bold>
            [Enter]
          </Text>
          <Text> Get started</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>[q] Quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
