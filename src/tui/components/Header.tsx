import React from 'react';
import { Box, Text } from 'ink';
import type { SystemStats } from '../../monitor/stats.js';

interface HeaderProps {
  stats: SystemStats | null;
}

export function Header({ stats }: HeaderProps): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderBottom
      borderLeft={false}
      borderRight={false}
      borderTop={false}
      paddingX={1}
    >
      <Box flexGrow={1}>
        <Text bold color="cyan">
          🛬 OpenLander
        </Text>
        <Text dimColor> v0.4.0</Text>
      </Box>
      {stats && (
        <Box gap={2}>
          <Text dimColor>CPU: {stats.cpu.usagePercent}%</Text>
          <Text dimColor>RAM: {stats.memory.usagePercent}%</Text>
          <Text dimColor>Disk: {stats.disk.usagePercent}%</Text>
        </Box>
      )}
    </Box>
  );
}
