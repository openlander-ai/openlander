import React from 'react';
import { Box, Text } from 'ink';
import type { SystemStats } from '../../monitor/stats.js';
import type { ProjectRow } from '../../db/index.js';

interface SystemOverviewProps {
  stats: SystemStats | null;
  projects: ProjectRow[];
  llmProvider: string | null;
}

function bar(percent: number, width = 20): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function SystemOverview({
  stats,
  projects,
  llmProvider,
}: SystemOverviewProps): React.ReactElement {
  const running = projects.filter((p) => p.status === 'running').length;
  const stopped = projects.filter((p) => p.status === 'stopped').length;
  const building = projects.filter((p) => p.status === 'building').length;
  const errored = projects.filter((p) => p.status === 'error').length;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        System Overview
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Projects</Text>
        <Box gap={2}>
          <Text color="green">● {running} running</Text>
          <Text dimColor>○ {stopped} stopped</Text>
          {building > 0 && <Text color="yellow">⏳ {building} building</Text>}
          {errored > 0 && <Text color="red">⚠ {errored} error</Text>}
        </Box>
      </Box>

      {stats && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Resources</Text>
          <Box>
            <Text dimColor>CPU: </Text>
            <Text
              color={
                stats.cpu.usagePercent > 80
                  ? 'red'
                  : stats.cpu.usagePercent > 50
                    ? 'yellow'
                    : 'green'
              }
            >
              {bar(stats.cpu.usagePercent)} {stats.cpu.usagePercent}%
            </Text>
            <Text dimColor> ({stats.cpu.cores} cores)</Text>
          </Box>
          <Box>
            <Text dimColor>RAM: </Text>
            <Text
              color={
                stats.memory.usagePercent > 80
                  ? 'red'
                  : stats.memory.usagePercent > 50
                    ? 'yellow'
                    : 'green'
              }
            >
              {bar(stats.memory.usagePercent)} {stats.memory.usagePercent}%
            </Text>
            <Text dimColor>
              {' '}
              ({stats.memory.usedMB}MB / {stats.memory.totalMB}MB)
            </Text>
          </Box>
          <Box>
            <Text dimColor>Disk: </Text>
            <Text
              color={
                stats.disk.usagePercent > 90
                  ? 'red'
                  : stats.disk.usagePercent > 70
                    ? 'yellow'
                    : 'green'
              }
            >
              {bar(stats.disk.usagePercent)} {stats.disk.usagePercent}%
            </Text>
            <Text dimColor>
              {' '}
              ({stats.disk.usedGB}GB / {stats.disk.totalGB}GB)
            </Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Config</Text>
        <Box>
          <Text dimColor>LLM: </Text>
          {llmProvider ? (
            <Text color="green">{llmProvider}</Text>
          ) : (
            <Text color="yellow">Not configured</Text>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Use chat below to deploy: &quot;Deploy github.com/user/repo&quot;</Text>
      </Box>
    </Box>
  );
}
