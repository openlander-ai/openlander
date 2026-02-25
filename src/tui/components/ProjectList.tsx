import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectRow } from '../../db/index.js';

interface ProjectListProps {
  projects: ProjectRow[];
  selectedIndex: number;
}

const STATUS_ICON: Record<string, string> = {
  running: '●',
  stopped: '○',
  building: '⏳',
  error: '⚠',
};

const STATUS_COLOR: Record<string, string> = {
  running: 'green',
  stopped: 'gray',
  building: 'yellow',
  error: 'red',
};

export function ProjectList({ projects, selectedIndex }: ProjectListProps): React.ReactElement {
  if (projects.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Projects</Text>
        <Text dimColor>No projects yet.</Text>
        <Text dimColor>Use the chat to deploy:</Text>
        <Text color="cyan">&quot;Deploy github.com/user/repo&quot;</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Projects ({projects.length})</Text>
      {projects.map((p, i) => {
        const isSelected = i === selectedIndex;
        const icon = STATUS_ICON[p.status] ?? '?';
        const color = STATUS_COLOR[p.status] ?? 'white';
        return (
          <Box key={p.id}>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {isSelected ? '▸ ' : '  '}
            </Text>
            <Text color={color}>{icon} </Text>
            <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
              {p.name}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate Enter select</Text>
      </Box>
    </Box>
  );
}
