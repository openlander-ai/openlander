import React from 'react';
import { Box, Text, useInput, useApp } from 'ink';

import { PatchNotes } from './PatchNotes.js';
import { VERSION } from './version.js';
import { getDataDir } from '../../config/index.js';

export interface ReadyProps {
  onNext: () => void;
}

/**
 * Ready screen - final onboarding screen.
 * Shows security notice, data paths, and patch notes.
 */
export function Ready({ onNext }: ReadyProps): React.ReactElement {
  const { exit } = useApp();
  const dataDir = getDataDir();

  useInput((input, key) => {
    if (key.return) {
      onNext();
    }
    if (input.toLowerCase() === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={24} padding={2}>
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
          <Text bold color="green">
            [5/5] Ready!
          </Text>
        </Box>

        {/* Security notice */}
        <Box flexDirection="column" alignItems="center" marginTop={1}>
          <Box marginBottom={1}>
            <Text color="yellow">⚠️ OpenLander will:</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>• Manage Docker containers on this machine</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>• Control Traefik routing (port 80)</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>• Clone repositories via SSH</Text>
          </Box>
        </Box>

        {/* Data paths */}
        <Box flexDirection="column" alignItems="center" marginTop={1}>
          <Box marginBottom={1}>
            <Text dimColor>Data directory:</Text>
          </Box>
          <Box>
            <Text color="cyan">{dataDir}/</Text>
          </Box>
        </Box>

        {/* Patch notes */}
        <Box marginTop={1}>
          <PatchNotes version={VERSION} />
        </Box>

        {/* Action prompt */}
        <Box marginTop={2}>
          <Text color="green" bold>
            [Enter]
          </Text>
          <Text> Start OpenLander</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>[q] Quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
