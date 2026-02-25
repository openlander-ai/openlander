import React from 'react';
import { Box, Text } from 'ink';
import type { ProjectRow } from '../../db/index.js';

interface ProjectDetailProps {
  project: ProjectRow;
}

export function ProjectDetail({ project }: ProjectDetailProps): React.ReactElement {
  const localUrl = project.assigned_port ? `http://${project.name}.localhost` : null;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        {project.name}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>Status: </Text>
          <Text
            color={
              project.status === 'running'
                ? 'green'
                : project.status === 'error'
                  ? 'red'
                  : project.status === 'building'
                    ? 'yellow'
                    : 'gray'
            }
          >
            {project.status}
          </Text>
        </Box>
        {project.repo_url && (
          <Box>
            <Text dimColor>Repo: </Text>
            <Text>{project.repo_url}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Branch: </Text>
          <Text>{project.branch}</Text>
        </Box>
        {localUrl && (
          <Box>
            <Text dimColor>Local: </Text>
            <Text color="cyan">{localUrl}</Text>
          </Box>
        )}
        {project.public_url && (
          <Box>
            <Text dimColor>Public: </Text>
            <Text color="green">{project.public_url}</Text>
          </Box>
        )}
        {project.dockerfile_path && project.dockerfile_path !== 'Dockerfile' && (
          <Box>
            <Text dimColor>Docker: </Text>
            <Text>{project.dockerfile_path}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Created: </Text>
          <Text>{project.created_at}</Text>
        </Box>
      </Box>
      <Box
        marginTop={1}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text dimColor>[r] Redeploy [s] Stop [p] Make Public [l] Logs [d] Delete [Esc] Back</Text>
      </Box>
    </Box>
  );
}
